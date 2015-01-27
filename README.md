# Mozilla Taskcluster

[![Documentation Status](https://readthedocs.org/projects/mozilla-taskcluster/badge/?version=latest)](https://readthedocs.org/projects/mozilla-taskcluster/?badge=latest)

[Read the docs](http://mozilla-taskcluster.readthedocs.org/en/latest/)

## Developing

Development can be setup locally but the intended environment is fig.

Here are a few examples:

```sh
fig run test /bin/bash

# The app is now volume mounted to /app and redis, etc.. is setup

./node_modules/.bin/mocha test/<file>_test.js
```

## Deployments

This repository automatically deploys on code changes (via heroku ->
github integration).

The `master` branch is configured to deploy on code changes
(mozilla-taskcluster-staging) and will
submit data to staging treeherder.

The `production` branch is configured to deploy code changes
(mozilla-taskcluster) and will submit data to production treeherder.
