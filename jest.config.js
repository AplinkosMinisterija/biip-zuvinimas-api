/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  coverageDirectory: './coverage',
  rootDir: './',
  roots: ['./test'],
  setupFiles: ['./test/helpers/setup.js'],
  moduleFileExtensions: ['ts', 'tsx', 'js'],
  testMatch: ['**/*.spec.(ts|js)'],
  testTimeout: 60000,
};
