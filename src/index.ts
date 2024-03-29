import { Block, KnownBlock, WebClient } from "@slack/web-api";
import "dotenv/config";
import {
  option,
  reader,
  readerTaskEither,
  readonlyArray,
  readonlyNonEmptyArray,
  readonlyRecord,
  string,
  taskEither,
} from "fp-ts";
import { pipe } from "fp-ts/function";
import { Octokit } from "octokit";

const parseEnvironmentVariables = () => {
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

const githubRepoApiBaseUrl = "https://api.github.com/repos/";
const getRepositoryNameFromRepositoryUrl = (repositoryUrl: string) =>
  repositoryUrl.replace(githubRepoApiBaseUrl, "");

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
        taskEither.tryCatch(
          () =>
            new Octokit({
              auth: githubToken,
            }).rest.search.issuesAndPullRequests({
              q: `state:open type:pr author:app/dependabot ${repositories
                .map((repo) => `repo:${repo}`)
                .join(" ")}`,
            }),
          (e) =>
            e instanceof Error
              ? e
              : new Error(
                  `An error occurred when calling github api: ${JSON.stringify(
                    e
                  )}`
                )
        )
    ),
    readerTaskEither.map(({ data: { items } }) =>
      items.map((pullRequest) => ({
        title: pullRequest.title,
        url: pullRequest.html_url,
        repo: getRepositoryNameFromRepositoryUrl(pullRequest.repository_url),
      }))
    )
  );

const formatPullRequestsForSlack = (
  pullRequests: ReadonlyArray<{
    title: string;
    url: string;
    repo: string;
  }>
) =>
  pipe(
    pullRequests,
    readonlyNonEmptyArray.fromReadonlyArray,
    option.map(readonlyNonEmptyArray.groupBy(({ repo }) => repo)),
    option.map(
      readonlyRecord.mapWithIndex((repo, pullRequests) => [
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
    ),
    option.map(
      readonlyRecord.collect(string.Ord)((_repo, sections) => sections)
    ),
    option.map(readonlyArray.flatten),
    option.getOrElseW(() => [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:tada: *No opened dependabot pull request*`,
        },
      },
    ])
  );

const postSlackMessage = (blocks: ReadonlyArray<Block | KnownBlock>) =>
  reader.asks(
    ({
      slackChannel,
      slackToken,
    }: {
      slackChannel: string;
      slackToken: string;
    }) =>
      taskEither.tryCatch(
        () =>
          new WebClient(slackToken).chat.postMessage({
            blocks: readonlyArray.toArray(blocks),
            channel: slackChannel,
          }),
        (e) =>
          e instanceof Error
            ? e
            : new Error(
                `An error occurred when calling slack api: ${JSON.stringify(e)}`
              )
      )
  );

(async () =>
  pipe(
    getPullRequestsToPublish(),
    readerTaskEither.map(formatPullRequestsForSlack),
    readerTaskEither.chainW(postSlackMessage),
    readerTaskEither.match(
      (e) => {
        console.error(e);
        process.exit(1);
      },
      () => {
        console.log("Success!");
      }
    )
  )(parseEnvironmentVariables())())();
