import fs from 'fs';
import path from 'path';
import walkdir from 'walkdir';
import minimatch from 'minimatch';
import component from './component';
import requirePackageName from 'require-package-name';
import DepsRegex from 'deps-regex';
const re = new DepsRegex();

function constructComponent(source, name) {
  return source[name].reduce((result, current) =>
    Object.assign(result, {
      [current]: require(path.resolve(__dirname, name, current)),
    }), {});
}

const availableSpecials = constructComponent(component, 'special');

const defaultOptions = {
  withoutDev: false,
  ignoreBinPackage: true,
  ignoreMatches: [
  ],
  ignoreDirs: [
    '.git',
    '.svn',
    '.hg',
    '.idea',
    'node_modules',
    'bower_components',
  ],
  specials: [
  ],
};

function getOrDefault(opt, key) {
  return typeof opt[key] !== 'undefined' ? opt[key] : defaultOptions[key];
}

function minus(array1, array2) {
  return array1.filter(item => array2.indexOf(item) === -1);
}

function intersect(array1, array2) {
  return array1.filter(item => array2.indexOf(item) !== -1);
}

function unique(array) {
  return array.filter((value, index) => array.indexOf(value) === index);
}

function getDependencies(dir, filename) {
  return new Promise((resolve, reject) => {
    fs.readFile(filename, 'utf8', (error, content) => {
      if (error) {
        reject(error);
      }

      try {
        const result = re(content);
        resolve(result);
      } catch (syntaxError) {
        reject(syntaxError);
      }
    });
  }).then(dependencies => {
    return dependencies.map(requirePackageName);
  });
}

function checkFile(dir, filename, deps, devDeps) {
  getDependencies(dir, filename)
    .then(used => ({
      dependencies: minus(deps, used),
      devDependencies: minus(devDeps, used),
    }), error => ({
      dependencies: deps,
      devDependencies: devDeps,
      invalidFiles: {
        [filename]: error,
      },
    }));
}

function checkDirectory(dir, ignoreDirs, deps, devDeps) {
  return new Promise(resolve => {
    const promises = [];
    const finder = walkdir(dir, { 'no_recurse': true });

    finder.on('directory', subdir =>
      ignoreDirs.indexOf(path.basename(subdir)) === -1 &&
      promises.push(
        checkDirectory(subdir, ignoreDirs, deps, devDeps)));

    finder.on('file', filename =>
      promises.push(
        ...checkFile(dir, filename, deps, devDeps)));

    finder.on('error', (dirPath, error) =>
      promises.push(Promise.resolve({
        dependencies: deps,
        devDependencies: devDeps,
        invalidDirs: {
          [dirPath]: error,
        },
      })));

    finder.on('end', () =>
      resolve(Promise.all(promises).then(results =>
        results.reduce((obj, current) => ({
          dependencies: intersect(obj.dependencies, current.dependencies),
          devDependencies: intersect(obj.devDependencies, current.devDependencies),
          invalidFiles: Object.assign(obj.invalidFiles, current.invalidFiles),
          invalidDirs: Object.assign(obj.invalidDirs, current.invalidDirs),
        }), {
          dependencies: deps,
          devDependencies: devDeps,
          invalidFiles: {},
          invalidDirs: {},
        }))));
  });
}

function isIgnored(ignoreMatches, dependency) {
  return ignoreMatches.some(match => minimatch(dependency, match));
}

function hasBin(rootDir, dependency) {
  try {
    const depPkg = require(path.join(rootDir, 'node_modules', dependency, 'package.json'));
    return depPkg.hasOwnProperty('bin');
  } catch (error) {
    return false;
  }
}

function filterDependencies(rootDir, ignoreBinPackage, ignoreMatches, dependencies) {
  return Object.keys(dependencies).filter(dependency =>
    ignoreBinPackage && hasBin(rootDir, dependency) ||
    isIgnored(ignoreMatches, dependency)
    ? false
    : true);
}

export default function depcheck(rootDir, options, cb) {
  const withoutDev = getOrDefault(options, 'withoutDev');
  const ignoreBinPackage = getOrDefault(options, 'ignoreBinPackage');
  const ignoreMatches = getOrDefault(options, 'ignoreMatches');
  const ignoreDirs = unique(defaultOptions.ignoreDirs.concat(options.ignoreDirs));

  const metadata = options.package || require(path.join(rootDir, 'package.json'));
  const dependencies = metadata.dependencies || {};
  const devDependencies = metadata.devDependencies || {};
  const deps = filterDependencies(rootDir, ignoreBinPackage, ignoreMatches, dependencies);
  const devDeps = filterDependencies(rootDir, ignoreBinPackage, ignoreMatches, withoutDev ? [] : devDependencies);

  return checkDirectory(rootDir, ignoreDirs, deps, devDeps)
    .then(cb);
}

depcheck.special = availableSpecials;
