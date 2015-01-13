import slugid from 'slugid';

export default class {
  constructor(queue) {
    this.queue = queue;
  }

  async createTask(overrides = {}) {
    let id = slugid.v4();
    let template = {
      provisionerId:  'not-a-real-provisioner',
      workerType:     'test',
      created:        new Date().toJSON(),
      deadline:       new Date(new Date().getTime() + 60 * 60 * 5).toJSON(),
      routes: [],
      payload: {},
      metadata: {
        name:         'Example Task',
        description:  'Markdown description of **what** this task does',
        owner:        'jonasfj@mozilla.com',
        source:       'http://docs.taskcluster.net/tools/task-creator/'
      },
      extra: {
        treeherder: {
          symbol:         'S',
          groupName:      'MyGroupName',
          groupSymbol:    'G',
          productName:    'MyProductName'
        }
      }
    };

    let task = Object.assign(template, overrides);
    await this.queue.createTask(id, task);
    return id;
  }
}