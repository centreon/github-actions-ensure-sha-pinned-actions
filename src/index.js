const core = require('@actions/core');
const fs = require('fs');
const glob = require('@actions/glob');
const path = require('path');
const yaml = require('yaml');

const sha1 = /\b[a-f0-9]{40}\b/i;
const sha256 = /\b[A-Fa-f0-9]{64}\b/i;

async function run() {
  try {
    const allowlist = core.getInput('allowlist');
    const isDryRun = core.getInput('dry_run') === 'true';
    const workflowsPath = '.github/workflows';
    const actionsPath = '.github/actions';
    const globber = await glob.create([
      `${workflowsPath}/*.yaml`,
      `${workflowsPath}/*.yml`,
      `${actionsPath}/**/action.yaml`,
      `${actionsPath}/**/action.yml`
    ].join('\n'))
    let actionHasError = false;

    // Debug globber
    const matchedFiles = await globber.glob();
    console.log('Matched files:', matchedFiles);

    for await (const file of globber.globGenerator()) {
      const basename = path.basename(file);
      const fileContents = fs.readFileSync(file, 'utf8');
      const yamlContents = yaml.parse(fileContents);

      let fileHasError = false;
      let filePath;
      let steps;
      let jobs;

      if (basename.match(/^action.*/)) {
        filePath = actionsPath + '/' + path.basename(path.dirname(file)); + '/' + basename;
        runs = yamlContents['runs'];
      } else {
        filePath = workflowsPath + '/' + basename;
        jobs = yamlContents['jobs'];
      }

      if (jobs === undefined && steps === undefined) {
        core.setFailed(`The "${filePath}" file does not contain any element on which to iterate.`);
      }

      core.startGroup(filePath);
      if (jobs !== undefined) {
        for (const job in jobs) {
          steps = jobs[job]['steps'];
          uses = jobs[job]['uses'];
          let jobHasError = false;
          if (uses !== undefined) {
            jobHasError = runAssertions(uses, allowlist, isDryRun);
          } else if (steps !== undefined) {
            for (const step of steps) {
              if (!jobHasError) {
                jobHasError = runAssertions(step['uses'], allowlist, isDryRun);
              }
            }
          } else {
            core.warning(`The "${job}" job of the "${filePath}" file does not contain uses or steps.`);
          }

          if (jobHasError) {
            actionHasError = true;
            fileHasError = true;
          }
        }
      } else if (runs !== undefined) {
        for (const run in runs) {
          steps = runs[run]['steps'];
          uses = runs[run]['uses'];
          let jobHasError = false;
          if (uses !== undefined) {
            jobHasError = runAssertions(uses, allowlist, isDryRun);
          } else if (steps !== undefined) {
            for (const step of steps) {
              if (!jobHasError) {
                jobHasError = runAssertions(step['uses'], allowlist, isDryRun);
              }
            }
          } else {
            core.warning(`The "${run}" run of the "${filePath}" file does not contain uses or steps.`);
          }

          if (jobHasError) {
            actionHasError = true;
            fileHasError = true;
          }
        }
      }

      if (!fileHasError) {
        core.info('No issues were found.')
      }

      core.endGroup();
    }

    if (!isDryRun && actionHasError) {
      throw new Error('At least one workflow contains an unpinned GitHub Action version.');
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();

function assertUsesVersion(uses) {
  return typeof uses === 'string' && uses.includes('@');
}

function assertUsesSha(uses) {
  if (uses.startsWith('docker://')) {
    return sha256.test(uses.substr(uses.indexOf('sha256:') + 7));
  }

  return sha1.test(uses.substr(uses.indexOf('@') + 1));
}

function assertUsesAllowlist(uses, allowlist) {
  if (!allowlist) {
    return false;
  }

  const action = uses.substr(0, uses.indexOf('@'));
  const isAllowed = allowlist.split(/\r?\n/).some((allow) => action.startsWith(allow));

  if(isAllowed) {
    core.info(`${action} matched allowlist — ignoring action.`)
  }

  return isAllowed;
}

function runAssertions(uses, allowlist, isDryRun) {
  const hasError = assertUsesVersion(uses) && !assertUsesSha(uses) && !assertUsesAllowlist(uses, allowlist);

  if (hasError) {
    const message = `${uses} is not pinned to a full length commit SHA.`;

    if (isDryRun) {
      core.warning(message);
    } else {
      core.error(message);
    }
  }

  return hasError;
}
