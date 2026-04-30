'use strict';

module.exports = {
  name: 'echo',
  description: 'Replies with the text you send it.',
  run({ input }) {
    return input || '';
  }
};
