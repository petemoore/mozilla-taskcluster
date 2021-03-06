import assert from 'assert';
import eventToPromise from 'event-to-promise';
import waitFor from '../wait_for';
import testSetup from '../monitor';
import * as kueUtils from '../kue';
import createResultset from '../../src/treeherder/resultset';
import slugid from 'slugid';

import PushlogClient from '../../src/pushlog/client';
import Project from 'mozilla-treeherder/project';
import TreeherderHelper from '../treeherder';
import TaskclusterHelper from '../taskcluster';

let Joi = require('joi');


suite('bin/treeherder_taskcluster.js', function() {
  let monitorSetup = testSetup('workers.js', 'pulse_listener.js');

  // prior to testing anything we need to create a resultset...
  let treeherder;
  let taskcluster;
  let revisionHash;
  let route;
  setup(async function() {
    treeherder = new TreeherderHelper(this.config.treeherder.apiUrl);
    taskcluster = new TaskclusterHelper(this.scheduler);

    await monitorSetup.hg.write('xfoobar', `xfoo ${Date.now()}`);
    await monitorSetup.hg.commit();
    await monitorSetup.hg.push();

    let pushlog = new PushlogClient();
    let push = await pushlog.getOne(monitorSetup.url, 1);
    let resultset = createResultset('try', {
      changesets: push.changesets
    });
    revisionHash = resultset.revision_hash;

    await treeherder.waitForResultset(revisionHash);

    route = [
      this.config.treeherderTaskcluster.routePrefix,
      'try',
      revisionHash
    ].join('.');
  });

  async function throttle(config) {
    let proj = new Project('try', {
      consumerKey: 'try',
      consumerSecret: 'try',
      baseUrl: config.treeherder.apiUrl
    });

    try {
      while (true) {
        let job = await Promise.all([
          proj.postJobs([]),
          proj.postJobs([]),
          proj.postJobs([]),
          proj.postJobs([]),
          proj.postJobs([]),
          proj.postJobs([]),
          proj.postJobs([]),
          proj.postJobs([]),
          proj.postJobs([]),
          proj.postJobs([]),
          proj.postJobs([]),
          proj.postJobs([]),
          proj.postJobs([]),
          proj.postJobs([]),
          proj.postJobs([]),
          proj.postJobs([]),
        ]);
      }
    } catch (e) {
      return e;
    }
  }

  test('throttle handling', async function() {
    this.timeout('2min');
    // First throttle treeherder so it refused to respond....
    let throttleErr = await throttle(this.config);

    // Create our task this should fail without throttle retries.
    let [, taskId] = await taskcluster.createTaskGraph({
      tasks: [{
        task: {
          routes: [route]
        }
      }]
    });

    // Wait for task to be in the pending state...
    await treeherder.waitForJobState(
      revisionHash,
      taskId,
      0,
      'pending'
    );
  });

  test('symbol + machine customizations', async function() {
    let [, taskId] = await taskcluster.createTaskGraph({
      tasks: [{
        task: {
          routes: [route],
          extra: {
            treeherder: {
              build: {
                platform: 'zomgplatform',
                os: 'zomg',
                architecture: 'wootbar'
              },
              machine: {
                platform: 'wootbar_machine',
                os: 'madeup',
                architecture: 'value'
              },
              symbol: 7,
              collection: {
                debug: true
              }
            }
          }
        }
      }]
    });

    // Wait for task to be in the pending state...
    let job = await treeherder.waitForJobState(
      revisionHash, taskId, 0, 'pending'
    );

    Joi.assert(job, Joi.object().keys({
      who: Joi.string().valid('user@example.com'),
      job_type_name: Joi.string().valid('Example Task name'),
      job_type_symbol: Joi.string().valid('7'),

      build_platform: Joi.string().valid('zomgplatform'),
      build_os: Joi.string().valid('zomg'),
      build_architecture: Joi.string().valid('wootbar'),

      platform: Joi.string().valid('wootbar_machine'),
      machine_platform_os: Joi.string().valid('madeup'),
      machine_platform_architecture: Joi.string().valid('value'),

      platform_option: Joi.string().valid('debug')
    }).unknown(true))
  });

  // Skipped on CI due to intermittent status...
  test('@ci-skip state transition -> pending -> retry', async function() {
    this.timeout('2min');
    let [, taskId] = await taskcluster.createTaskGraph({
      tasks: [{
        reruns: 1,
        task: {
          routes: [route]
        }
      }]
    });

    // Wait for task to be in the pending state...
    await treeherder.waitForJobState(
      revisionHash,
      taskId,
      0,
      'pending'
    );

    // Claim/complete the task in its initial state
    await this.queue.claimTask(taskId, 0, {
      workerGroup: 'test',
      workerId: 'test'
    });
    await this.queue.reportCompleted(taskId, 0, { success:  false });

    // Issue the rerun
    await this.queue.rerunTask(taskId);

    // Reclaim the task with new run id
    await this.queue.claimTask(taskId, 1, {
      workerGroup: 'test',
      workerId: 'test'
    });

    await waitFor(async function() {
      let rerun = await treeherder.waitForJobState(
        revisionHash,
        taskId,
        0,
        'completed'
      );
      return rerun.result === 'retry';
    });

    await this.queue.reportFailed(taskId, 1);

    await waitFor(async function() {
      let finalRun = await treeherder.waitForJobState(
        revisionHash,
        taskId,
        1,
        'completed'
      );
      return finalRun.result === 'testfailed';
    });
  });

  test('state transition -> pending -> running -> completed', async function() {
    let [, taskId] = await taskcluster.createTaskGraph({
      tasks: [{
        task: {
          routes: [route]
        }
      }]
    });

    // Wait for task to be in the pending state...
    await treeherder.waitForJobState(
      revisionHash,
      taskId,
      0,
      'pending'
    );

    // Claim task so it is running...
    await this.queue.claimTask(taskId, 0, {
      workerGroup: 'test',
      workerId: 'test'
    });
    await treeherder.waitForJobState(
      revisionHash,
      taskId,
      0,
      'running'
    );

    // Report completed + success...
    await this.queue.reportCompleted(taskId, 0);
    let job = await treeherder.waitForJobState(
      revisionHash,
      taskId,
      0,
      'completed'
    );
    assert.equal(job.result, 'success');
  });

  test('state transition -> pending -> running -> failed', async function() {
    let [, taskId] = await taskcluster.createTaskGraph({
      tasks: [{
        task: {
          routes: [route]
        }
      }]
    });

    // Wait for task to be in the pending state...
    await treeherder.waitForJobState(
      revisionHash,
      taskId,
      0,
      'pending'
    );

    // Claim task so it is running...
    await this.queue.claimTask(taskId, 0, {
      workerGroup: 'test',
      workerId: 'test'
    });
    await treeherder.waitForJobState(
      revisionHash,
      taskId,
      0,
      'running'
    );

    // Report completed + success...
    await this.queue.reportFailed(taskId, 0);
    let job = await treeherder.waitForJobState(
      revisionHash,
      taskId,
      0,
      'completed'
    );
    assert.equal(job.result, 'testfailed');
  });

  test('state transition -> pending -> running -> exception', async function() {
    let [, taskId] = await taskcluster.createTaskGraph({
      tasks: [{
        task: {
          routes: [route]
        }
      }]
    });

    // Wait for task to be in the pending state...
    await treeherder.waitForJobState(
      revisionHash,
      taskId,
      0,
      'pending'
    );

    // Claim task so it is running...
    await this.queue.claimTask(taskId, 0, {
      workerGroup: 'test',
      workerId: 'test'
    });
    await treeherder.waitForJobState(
      revisionHash,
      taskId,
      0,
      'running'
    );

    // Report completed + success...
    await this.queue.reportException(taskId, 0, {
      reason: 'malformed-payload'
    });

    let job = await treeherder.waitForJobState(
      revisionHash,
      taskId,
      0,
      'completed'
    );
    assert.equal(job.result, 'exception');
  });
});
