/**
 * fs/promises のモック
 */

import { jest } from '@jest/globals';

export const readFile = jest.fn<() => Promise<string>>();
export const readdir = jest.fn<() => Promise<string[]>>();
export const access = jest.fn<() => Promise<void>>();
export const writeFile = jest.fn<() => Promise<void>>();
export const mkdir = jest.fn<() => Promise<void>>();
export const stat = jest.fn<() => Promise<object>>();

export default {
  readFile,
  readdir,
  access,
  writeFile,
  mkdir,
  stat,
};
