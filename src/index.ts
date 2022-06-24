import "dotenv/config";
import { Octokit } from "octokit";
import { WebClient } from "@slack/web-api";
import { groupBy } from "lodash";

const parseEnvironmentVariables = async () => {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken || githubToken.length === 0) {
    throw new Error(
      "Missing github authorization token. Set it with the environment variable GITHUB_TOKEN"
    );
  }
  const slackToken = process.env.SLACK_TOKEN;
  if (!slackToken || slackToken.length === 0) {
    throw new Error(
      "Missing slack authorization token. Set it with the environment variable SLACK_TOKEN"
    );
  }

  const slackChannel = process.env.SLACK_CHANNEL;
  if (!slackChannel || slackChannel.length === 0) {
    throw new Error(
      "Missing slack channel id. Set it with the environment variable SLACK_CHANNEL"
    );
  }

  const repositories = process.env.GITHUB_REPOSITORIES;
  if (!repositories || repositories.length === 0) {
    throw new Error(
      "Missing github repositories to inspect. Set them coma-separated with the environment variable GITHUB_REPOSITORIES"
    );
  }

  return {
    repositories: repositories.split(","),
    slackChannel,
    githubToken,
    slackToken,
  };
};

const getPullRequestsToPublish = async (
  githubToken: string,
  repositories: ReadonlyArray<string>
) => {
  const {
    data: { items: pullRequests },
  } = await new Octokit({
    auth: githubToken,
  }).rest.search.issuesAndPullRequests({
    q: `state:open type:pr author:app/dependabot ${repositories
      .map((repo) => `repo:${repo}`)
      .join(" ")}`,
  });

  return pullRequests.map((pr) => ({
    title: pr.title,
    url: pr.html_url,
    repo: pr.repository_url.replace("https://api.github.com/repos/inato/", ""),
  }));
};

const publishToSlack = (
  slackChannel: string,
  slackToken: string,
  pullRequests: ReadonlyArray<{
    title: string;
    url: string;
    repo: string;
  }>
) => {
  const grouped = groupBy(pullRequests, ({ repo }) => repo);
  const groupedAsObjectEntries = Object.entries(grouped);

  if (groupedAsObjectEntries.length === 0) {
    return new WebClient(slackToken).chat.postMessage({
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:tada: *No opened dependabot pull request*`,
          },
        },
      ],
      channel: slackChannel,
    });
  }

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Currently opened dependabot pull request:*",
      },
    },
    {
      type: "divider",
    },
    ...groupedAsObjectEntries
      .map(([repo, pullRequests]) => [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${repo}*`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: pullRequests
              .map(({ title, url }) => `• <${url}|${title}>`)
              .join("\n"),
          },
        },
      ])
      .flat(),
  ];

  return new WebClient(slackToken).chat.postMessage({
    blocks,
    channel: slackChannel,
  });
};

(async () => {
  const { slackChannel, repositories, slackToken, githubToken } =
    await parseEnvironmentVariables();
  return publishToSlack(
    slackChannel,
    slackToken,
    await getPullRequestsToPublish(githubToken, repositories)
  );
})();
