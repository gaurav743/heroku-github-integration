import * as core from "@actions/core";
import * as github from "@actions/github";
import Heroku from "heroku-client/index";
const HerokuClient = require("heroku-client");

interface ReviewApp {
  pr_number: number;
  id: number;
}

interface TarballResponse {
  status: number;
  url: string;
}

async function run() {
  core.debug(JSON.stringify(github.context));

  const ctx = github.context;
  const pr = ctx.payload.pull_request!;
  const fork = pr.head.repo.fork;
  const branch = pr.head.ref;
  const version = pr.head.sha;
  const pr_number = pr.number;
  const action = core.getInput("action");
  const issue = ctx.issue;
  const pipeline = process.env.HEROKU_PIPELINE_ID;

  if (fork) {
    core.info("PRs from forked repos can't trigger this action");
    return;
  }

  core.debug("connecting to heroku");
  let heroku: Heroku | undefined;

  try {
    heroku = new HerokuClient({ token: process.env.HEROKU_API_TOKEN });
  } catch (error) {
    core.error(JSON.stringify(error));
  }

  if (!heroku) {
    core.error(
      "Couldn't connect to Heroku, make sure the HEROKU_API_TOKEN is set"
    );
    return;
  }

  const destroyReviewApp = async () => {
    core.info("Fetching Review Apps list");
    try {
      const reviewApps: ReviewApp[] = await heroku!.get(
        `/pipelines/${pipeline}/review-apps`
      );

      const app = reviewApps.find((app) => app.pr_number == pr_number);
      if (app) {
        core.info("Destroying Review App");
        await heroku!.delete(`/review-apps/${app.id}`);
        core.info("Review App destroyed");
      }
    } catch (error) {
      core.error(JSON.stringify(error));
      return;
    }
  };

  const findReviewApp = async () => {
    const apiUrl = `/pipelines/${pipeline}/review-apps`;
    core.debug(`Listing review apps: "${apiUrl}"`);
    const reviewApps = await heroku!.get(apiUrl);
    core.info(`Listed ${reviewApps.length} review apps OK: ${reviewApps.length} apps found.`);

    core.debug(`Finding review app for PR #${pr_number}...`);
    const app = reviewApps.find((app: any) => app.pr_number === pr_number);
    if (app) {
      const { status } = app;
      if ('errored' === status) {
        core.notice(`Found review app for PR #${pr_number} OK, but status is "${status}"`);
        return null;
      }
      core.info(`Found review app for PR #${pr_number} OK: ${JSON.stringify(app)}`);
    } else {
      core.info(`No review app found for PR #${pr_number}`);
    }
    return app;
  };

  const updateReviewApp = async () => {
    core.debug("init octokit");
    if (!process.env.GITHUB_TOKEN) {
      core.error(
        "Couldn't connect to GitHub, make sure the GITHUB_TOKEN secret is set"
      );
      return;
    }
    const octokit = github.getOctokit(process.env.GITHUB_TOKEN);

    if (!octokit) {
      core.error(
        "Couldn't connect to GitHub, make sure the GITHUB_TOKEN is a valid token"
      );
      return;
    }

    let reviewApp = findReviewApp();

    const { url }: TarballResponse =
      await octokit.rest.repos.downloadTarballArchive({
        method: "HEAD",
        owner: issue.owner,
        repo: issue.repo,
        ref: branch,
      });

    try {
      core.info("Updating Review App");
      core.debug(
        JSON.stringify({
          branch,
          pipeline,
          source_blob: {
            url,
            version,
          },
          pr_number,
        })
      );
      const response = await heroku!.post("/apps/${reviewApp.id}/builds", {
        body: {
          source_blob: {
            url,
            version,
          }
        },
      });
      core.debug(response);
      core.info("Review App updated");
    } catch (error) {
      core.error("Error while updating build");
      core.error(JSON.stringify(error));
    }
  };

  const createReviewApp = async () => {
    core.debug("init octokit");
    if (!process.env.GITHUB_TOKEN) {
      core.error(
        "Couldn't connect to GitHub, make sure the GITHUB_TOKEN secret is set"
      );
      return;
    }
    const octokit = github.getOctokit(process.env.GITHUB_TOKEN);

    if (!octokit) {
      core.error(
        "Couldn't connect to GitHub, make sure the GITHUB_TOKEN is a valid token"
      );
      return;
    }

    const { url }: TarballResponse =
      await octokit.rest.repos.downloadTarballArchive({
        method: "HEAD",
        owner: issue.owner,
        repo: issue.repo,
        ref: branch,
      });

    try {
      core.info("Creating Review App");
      core.debug(
        JSON.stringify({
          branch,
          pipeline,
          source_blob: {
            url,
            version,
          },
          pr_number,
        })
      );
      const response = await heroku!.post("/review-apps", {
        body: {
          branch,
          pipeline,
          source_blob: {
            url,
            version,
          },
          pr_number,
        },
      });
      core.debug(response);
      core.info("Review App created");
    } catch (error) {
      core.error(JSON.stringify(error));
    }
  };

  switch (action) {
    case "destroy":
      destroyReviewApp();
      break;
    case "create":
      createReviewApp();
      break;
    case "update":
      updateReviewApp();
      break;
    default:
      core.debug(
        "Invalid action, no action was performed, use one of 'create' or 'destroy'"
      );
      break;
  }
}

run();
