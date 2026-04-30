'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class Store {
  constructor(filePath, fallback = {}) {
    this.filePath = filePath;
    this.fallback = fallback;
  }

  async read() {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return this.fallback;
      throw new Error(`Could not read store ${this.filePath}: ${error.message}`);
    }
  }

  async write(value) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  async update(mutator) {
    const current = await this.read();
    const next = await mutator(current);
    await this.write(next);
    return next;
  }
}

module.exports = { Store };
