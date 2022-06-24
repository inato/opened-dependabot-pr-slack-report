# opened-dependabot-pr-slack-report

Tool to report to Slack the list of dependabot pull requests currently opened

## Installation

- run `yarn`
- copy the file `.env.template` to `.env` and fill the environment variable values in it

## Usage

- run `yarn start`
- If you want to override the list of repositories of you `.env` file, you can set the environment variable in the command: `GITHUB_REPOSITORIES=myOrg/someRepo yarn start`
