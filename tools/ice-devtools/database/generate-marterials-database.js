const fs = require('fs');
const path = require('path');
const glob = require('glob');
const mkdirp = require('mkdirp');
const moment = require('moment');
const uppercamelcase = require('uppercamelcase');
const rp = require('request-promise');
const pathExists = require('path-exists');
const depAnalyze = require('../shared/dep-analyze');
const { checkAndQueryNpmTime } = require('../shared/utils');

function generatePartciple(payload, source) {
  if (process.env.PARTICIPLE) {
    const { cut } = require('../shared/participle');
    // 分词 payload
    const participle = {
      title: cut(source.title),
      content: cut(source.content),
    };
    if (payload && payload.features) {
      payload.features.participle = participle;
    }
  }
}

/**
 * 生成 blocks 信息列表
 * @param {*} files
 * @param {*} SPACE
 * @param {String} type | block or react
 */
function generateBlocks(files, SPACE, type, done) {
  const result = [];
  files.forEach((pkgPath) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(SPACE, pkgPath)));
    const indexPoint = path.resolve(SPACE, pkgPath, '../src/index.js');

    // blockConfig or layoutConfig
    const configKey = `${type}Config`;
    const pkgConfig = pkg[configKey] || {};

    const payload = {
      // (必)英文名
      name: pkgConfig.name,
      // (必)中文描述
      title: pkgConfig.title,
      source: {
        type: 'npm',
        npm: pkg.name,
        version: pkg.version,
        // layout or block need src/
        sourceCodeDirectory: 'src/',
      },
      // (必) 用于说明组件依赖关系
      dependencies: pkg.dependencies || {},
      // (必) 截图
      // 兼容 snapshot 字段, 但是不推荐
      screenshot: pkgConfig.screenshot || pkgConfig.snapshot,

      categories: pkgConfig.categories || [],
      // publishTime: pkg.publishTime || new Date().toISOString(),
    };

    if (pathExists.sync(indexPoint)) {
      const componentDeps = depAnalyze(indexPoint);
      const useComponents = componentDeps.map((mod) => {
        let basePackage = '';
        let className = '';
        if (mod.startsWith('@icedesign/base')) {
          basePackage = '@icedesign/base';
          const subCom = /@icedesign\/base\/lib\/(.*)/.exec(mod)[1];
          className = uppercamelcase(subCom);
        } else {
          basePackage = mod;
          const subCom = /@icedesign\/(.*)/.exec(mod)[1];
          className = uppercamelcase(subCom);
        }

        return {
          basePackage,
          className,
        };
      });

      payload.features = {
        useComponents,
      };
    }

    generatePartciple(payload, {
      title: pkgConfig.title,
      content: pkg.description,
    });

    // (可)区块详细说明, markdown 格式
    if (pkg.description) {
      payload.description = pkg.description;
    }

    // (可) 标签
    if (pkgConfig.categories) {
      payload.categories = pkgConfig.categories;
    }

    if (pkgConfig.thumbnail) {
      payload.thumbnail = pkgConfig.thumbnail;
    }

    if (pkgConfig.sketchURL) {
      payload.sketchURL = pkgConfig.sketchURL;
    }

    if (pkgConfig.icelandURL) {
      payload.sketchURL = pkgConfig.icelandURL;
    }

    // if registry is user defined
    if (pkg.publishConfig && pkg.publishConfig.registry) {
      payload.source.registry = pkg.publishConfig.registry;
    }

    // 预览地址
    if (pkg.homepage) {
      payload.homepage = pkg.homepage;
    }

    // 仓库地址
    if (pkg.repository && pkg.repository.url) {
      payload.repository = pkg.repository.url;
    }

    result.push(payload);
  });

  Promise.all(
    result.map((item) => {
      if (item.source.type !== 'npm') {
        return Promise.resolve();
      } else {
        return checkAndQueryNpmTime(item.source.npm, item.source.version).then(
          ([code, npmResult]) => {
            if (code == 0) {
              item.publishTime = npmResult.created;
              item.updateTime = npmResult.modified;
              return Promise.resolve();
            } else {
              item.publishTime = null;
              item.updateTime = null;
              return Promise.resolve(npmResult);
            }
          }
        );
      }
    })
  ).then((allCheckStatus) => {
    const failedStatus = allCheckStatus.filter((n) => typeof n !== 'undefined');
    if (failedStatus.length > 0) {
      failedStatus.forEach((status) => {
        console.error(status.npm, status.version);
        console.error(status.message);
      });
      process.exit(1);
    }
    done(result);
  });
}

function generateScaffolds(files, SPACE, done) {
  const tasks = [];
  const result = files.map((pkgPath) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(SPACE, pkgPath)));
    const dependencies = pkg.dependencies || {};
    const devDependencies = pkg.devDependencies || {};

    const generatorJsonPath = path.resolve(pkgPath, '../generator.json');
    const generatorJson = {};
    if (fs.existsSync(generatorJsonPath)) {
      Object.assign(generatorJson, require(generatorJsonPath));
    }

    const payload = {
      // (必)英文名
      name: pkg.scaffoldConfig.name,
      // (必)中文描述
      title: pkg.scaffoldConfig.title,
      source: {
        type: 'npm',
        npm: pkg.name,
        version: pkg.version,
      },
      // (必) 用于说明组件依赖关系
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
      // (必) 截图
      screenshot: pkg.scaffoldConfig.screenshot || pkg.scaffoldConfig.snapshot,

      categories: pkg.scaffoldConfig.categories || [],
      // publishTime: pkg.publishTime || new Date().toISOString(),
      features: {},
    };

    tasks.push(
      checkAndQueryNpmTime(pkg.name, pkg.version).then(([code, npmResult]) => {
        if (code == 0) {
          payload.publishTime = npmResult.created;
          payload.updateTime = npmResult.modified;
          return Promise.resolve();
        } else {
          payload.publishTime = null;
          payload.updateTime = null;
          return Promise.resolve(npmResult);
        }
      })
    );

    generatePartciple(payload, {
      title: pkg.scaffoldConfig.title,
      content: pkg.description,
    });

    // (可)预览地址
    if (pkg.homepage) {
      payload.homepage = pkg.homepage;
    }

    // 仓库地址
    if (pkg.repository && pkg.repository.url) {
      payload.repository = pkg.repository.url;
    }

    // (可)区块详细说明, markdown 格式
    if (pkg.description) {
      payload.description = pkg.description;
    }

    // (可) 标签
    if (pkg.scaffoldConfig.categories) {
      payload.categories = pkg.scaffoldConfig.categories;
    }

    if (pkg.scaffoldConfig.thumbnail) {
      payload.thumbnail = pkg.scaffoldConfig.thumbnail;
    }

    if (pkg.scaffoldConfig.sketchURL) {
      payload.sketchURL = pkg.scaffoldConfig.sketchURL;
    }

    if (pkg.scaffoldConfig.icelandURL) {
      payload.sketchURL = pkg.scaffoldConfig.icelandURL;
    }

    // if registry is user defined
    if (pkg.publishConfig && pkg.publishConfig.registry) {
      payload.source.registry = pkg.publishConfig.registry;
    }

    return payload;
  });
  Promise.all(tasks).then((allCheckStatus) => {
    const failedStatus = allCheckStatus.filter((n) => typeof n !== 'undefined');
    if (failedStatus.length > 0) {
      failedStatus.forEach((status) => {
        console.error(status.npm, status.version);
        console.error(status.message);
      });
      process.exit(1);
    }
    done(result);
  });
}

/**
 * 生成 blocks or layouts 信息
 * @param {*} pattern
 * @param {*} SPACE
 */
function gatherBlocksOrLayouts(pattern, SPACE, type) {
  return new Promise((resolve, reject) => {
    glob(
      pattern, {
        cwd: SPACE,
        nodir: true,
      },
      (err, files) => {
        if (err) {
          console.log('err:', err);
          reject(err);
        } else {
          generateBlocks(files, SPACE, type, resolve);
        }
      }
    );
  });
}

/**
 * 生成 scaffolds 信息
 * @param {*} pattern
 * @param {*} SPACE
 */
function gatherScaffolds(pattern, SPACE) {
  return new Promise((resolve, reject) => {
    glob(
      pattern, {
        cwd: SPACE,
        nodir: true,
      },
      (err, files) => {
        if (err) {
          console.log('err:', err);
          reject(err);
        } else {
          generateScaffolds(files, SPACE, resolve);
        }
      }
    );
  });
}

/**
 * 从 npm 源补充字段
 * @param {*} npm npm 名
 * @param {*} version 版本号
 * @param {*} registry
 * @param {Object} appender 需要补充的字段, key 是返回的字段, 对应的 value 是 registry 返回的字段
 */
function appendFieldFromNpm(item) {
  const registry = 'http://registry.npm.taobao.org/';
  const { npm, version } = item;
  return rp({ uri: `${registry}${npm}`, json: true }).then((body) => {
    const latestVersionBody = body.versions[version];
    if (!latestVersionBody) {
      // check version is not published
      throw new Error(`${npm}@${version} is not published at ${registry}`);
    }
    const TIMEFMT = 'YYYY-MM-DD HH:mm';
    return Object.assign({}, item, {
      createdTime: moment(body.time.created).format(TIMEFMT),
      publishTime: moment(latestVersionBody.publish_time).format(TIMEFMT),
      keywords: latestVersionBody.keywords || [],
    });
  });
}

// entry and run
module.exports = function main(materialName, materialPath, options) {
  const distDir = path.resolve(process.cwd(), 'build');
  mkdirp.sync(distDir);

  return (
    Promise.resolve(materialPath)
    .then((space) => {
      return Promise.all([
        gatherBlocksOrLayouts('blocks/*/package.json', space, 'block'),
        gatherBlocksOrLayouts('layouts/*/package.json', space, 'layout'),
        gatherScaffolds('scaffolds/*/package.json', space),
      ]);
    })
    // .then(([blocks, layouts, scaffolds]) => {
    //   // 补充字段
    //   return Promise.all([
    //     Promise.all(blocks.map(appendFieldFromNpm)),
    //     Promise.all(layouts.map(appendFieldFromNpm)),
    //     Promise.all(scaffolds.map(appendFieldFromNpm)),
    //   ]);
    // })
    .then(([blocks, layouts, scaffolds]) => {
      const data = {
        name: materialName, // 物料池名
        type: options.type, // vue or react,...
        blocks,
        layouts,
        scaffolds,
      };

      const file = path.join(distDir, materialName + '.json');
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

      console.log(
        `${materialName} 物料数据生成完毕. Marterials DB Generated.\n${file}`
      );
    })
    .catch((err) => {
      console.log('uncaught error:\n', err.stack);
    })
  );
};
