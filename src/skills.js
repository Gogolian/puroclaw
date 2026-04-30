'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const SAFE_SKILL_NAME = /^[a-z0-9_-]+$/i;

function skillsRoot(cwd, config) {
  return path.join(cwd, config.skillsDir || 'skills');
}

async function listSkills(cwd, config) {
  const root = skillsRoot(cwd, config);
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SAFE_SKILL_NAME.test(entry.name)) continue;
    const skill = await loadSkill(cwd, config, entry.name);
    if (skill) skills.push(skill);
  }
  return skills;
}

async function loadSkill(cwd, config, name) {
  if (!SAFE_SKILL_NAME.test(name)) return null;
  const file = path.join(skillsRoot(cwd, config), name, 'skill.js');
  try {
    delete require.cache[require.resolve(file)];
    const skill = require(file);
    return {
      name: skill.name || name,
      description: skill.description || '',
      run: skill.run
    };
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' && error.message.includes(file)) return null;
    throw error;
  }
}

async function runSkill(cwd, config, name, input, context = {}) {
  const skill = await loadSkill(cwd, config, name);
  if (!skill) return null;
  if (typeof skill.run !== 'function') {
    throw new Error(`Skill "${name}" does not export a run() function.`);
  }
  const output = await skill.run({ input, ...context });
  return output == null ? '' : String(output);
}

module.exports = {
  listSkills,
  loadSkill,
  runSkill,
  skillsRoot
};
