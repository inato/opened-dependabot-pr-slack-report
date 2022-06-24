import { Block, KnownBlock, WebClient } from "@slack/web-api";
import "dotenv/config";
import { reader, readerTask } from "fp-ts";
import { pipe } from "fp-ts/function";
import { groupBy } from "lodash";
import { Octokit } from "octokit";

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

const getPullRequestsToPublish = () =>
  pipe(
    reader.asks(
      ({
          githubToken,
          repositories,
        }: {
          githubToken: string;
          repositories: ReadonlyArray<string>;
        }) =>
        () =>
          new Octokit({
            auth: githubToken,
          }).rest.search.issuesAndPullRequests({
            q: `state:open type:pr author:app/dependabot ${repositories
              .map((repo) => `repo:${repo}`)
              .join(" ")}`,
          })
    ),
    readerTask.map(({ data: { items } }) =>
      items.map((pullRequest) => ({
        title: pullRequest.title,
        url: pullRequest.html_url,
        repo: pullRequest.repository_url.replace(
          "https://api.github.com/repos/inato/",
          ""
        ),
      }))
    )
  );

const publishToSlack = (
  pullRequests: ReadonlyArray<{
    title: string;
    url: string;
    repo: string;
  }>
) => {
  const grouped = groupBy(pullRequests, ({ repo }) => repo);
  const groupedAsObjectEntries = Object.entries(grouped);

  if (groupedAsObjectEntries.length === 0) {
    return postSlackMessage([
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:tada: *No opened dependabot pull request*`,
        },
      },
    ]);
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

  return postSlackMessage(blocks);
};

const postSlackMessage = (blocks: Array<Block | KnownBlock>) =>
  reader.asks(
    ({
        slackChannel,
        slackToken,
      }: {
        slackChannel: string;
        slackToken: string;
      }) =>
      () =>
        new WebClient(slackToken).chat.postMessage({
          blocks,
          channel: slackChannel,
        })
  );

(async () => {
  const { slackChannel, repositories, slackToken, githubToken } =
    await parseEnvironmentVariables();
  return pipe(
    getPullRequestsToPublish(),
    readerTask.chainW(publishToSlack)
  )({ githubToken, repositories, slackChannel, slackToken })();
})();
