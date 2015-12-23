var crypto = require('crypto');
var path = require('path');
var exec = require('child_process').exec;

var del = require('del');
var Promise = require('bluebird');
var fs = require('graceful-fs');
var ncp = require('ncp');
var semverRegex = require('semver-regex');

var isWindows = process.platform.match(/^win/);

// This is needed to support corner case where current directory has a `p4.*` (e.g. `p4.js`) file.
// Windows cmd.exe will try to open that file instead of invoking p4.exe.
var p4cmd = isWindows ? 'p4.exe -c ' : 'p4 -c ';
var execp = Promise.promisify(exec);
var ncpp = Promise.promisify(ncp);
var rfp = Promise.promisify(fs.readFile);

/**
* Create a Perforce registry
* @param {object} options   Options from jspm (config?). Can contain any other registry-specific config.
* @param {string} options.tmpDir    Path to a folder the registry can use to store temporary files. This folder persists and is shared between installs.
* @param {string} options.versionString Represents the minor and major version of the registry package, which is used in the caching hash of packages. This can be altered and written to the instance allowing for custom registry cache invalidation - `this.versionString = options.versionString + '.53'``.
* @param {object} ui    Accessing the ui (console)
*/
var P4Registry = module.exports = function P4Registry(options, ui) {
    this.ui = ui;
    this.options = options;
    this.execOptions = {
        cwd: options.registryPath,
        timeout: options.timeout * 1000,
        killSignal: 'SIGKILL'
    };
};

P4Registry.configure = function configure(config, ui) {
    return Promise.resolve()
        .then(function () {
            return ui.input('p4 local registry path', config.registryPath);
        })
        .then(function (registryPath) {
            config.registryPath = registryPath;
            return ui.input('p4 local registry client name (P4CLIENT)', config.workspace);
        })
        .then(function (workspace) {
            config.workspace = workspace;
            return ui.input('Name the version that points to the lastest change (get yourModule@{this} to easily get the latest change without applying p4 label)', config.devTag || 'dev');
        })
        .then(function (devTag) {
            config.devTag = devTag;
            return config;
        });
};

P4Registry.packageFormat = /^@[^\/]+\/[^\/]+|^[^@\/][^\/]+/;

P4Registry.prototype = {
    lookup: function (packageName) {
        // console.log('lookup', packageName);
        var me = this;
        var root = path.resolve(this.options.registryPath);
        var packagePath = path.resolve(root, packageName);
        var p4PackagePath = path.resolve(packagePath, '...');

        return execp(p4cmd + me.options.workspace + ' labels ' + p4PackagePath, me.execOptions)
            .then(function (stdout) {
                var lines = stdout.split('\n');
                return Promise.reduce(lines, function (versions, line) {
                    if (!line) {
                        return versions;
                    }

                    var match = /Label (.*) \d/.exec(line);
                    if (match && match[1]) {
                        var version = match[1];

                        return execp(p4cmd + me.options.workspace + ' changes -m 1 ' + p4PackagePath + '@' + version, me.execOptions)
                            .then(function (changeLine) {
                                var stable = semverRegex().test(version);
                                versions[version] = {
                                    hash: crypto.createHash('sha1').update(packageName + changeLine).digest('hex')
                                };

                                if (!stable) {
                                    versions[version].stable = false;
                                }

                                return versions;
                            });
                    }
                    else {
                        console.warn('unable to get label from: "' + line + '"');
                        return versions;
                    }
                }, {});
            })
            .then(function (versions) {
                return execp(p4cmd + me.options.workspace + ' changes -m 1 ' + p4PackagePath, me.execOptions)
                    .then(function (changeLine) {
                        versions[me.options.devTag] = {
                            hash: crypto.createHash('sha1').update(packageName + changeLine).digest('hex'),
                            stable: false
                        };

                        // console.log('dev branch', changeLine, versions, me.execOptions);
                        return versions;
                    });
            })
            .then(function (versions) {
                // console.log(versions);
                return { versions: versions };
            })
            .catch(function (err) {
                if (typeof err === 'string') {
                    err = new Error(err);
                    err.hideStack = true;
                }
                err.retriable = true;
                throw err;
            });
    },
    download: function (packageName, version, hash, meta, dir) {
        // console.log('download', packageName, version, hash, meta, dir);
        var me = this;
        var root = path.resolve(this.options.registryPath);
        var packagePath = path.resolve(root, packageName);

        return this.prepare(packagePath, version)
            .then(function () {
                return ncpp(packagePath, dir, me.execOptions);
            })
            .then(function () {
                return execp(isWindows ? 'attrib -R /S ' + dir + '\\*' : 'chmod -R +w ' + dir + '/*');
            })
            .then(function () {
                var filepath = path.resolve(packagePath, 'package.json');
                // console.log(filepath);
                return rfp(filepath);

            })
            .then(function (pjson) {
                pjson = JSON.parse(pjson.toString());
                // console.log(pjson);
                return pjson;
            });
    },
    getPackageConfig: function (packageName, version, hash, meta) {
        // console.log('getPackageConfig', packageName, version, hash, meta);
        var root = path.resolve(this.options.registryPath);
        var packagePath = path.resolve(root, packageName);

        return this.prepare(packagePath, version)
            .then(function () {
                var filepath = path.resolve(packagePath, 'package.json');
                return rfp(filepath);

            })
            .then(function (pjson) {
                pjson = JSON.parse(pjson.toString());
                return pjson;
            });
    },
    prepare: function (packagePath, version) {
        if (this.preparing) {
            return this.preparing;
        }

        var me = this;
        var p4PackagePath = path.resolve(packagePath, '...');
        var syncCmd = p4cmd + me.options.workspace + ' sync -f ' + p4PackagePath;
        if (version != this.options.devTag) {
            syncCmd += '@' + version;
        }

        // Delete the package to avoid p4 unlink/chmod error during `sync -f` if the client has files that server don't. Messages are:
        // * unlink: {filePath}: The system cannot find the file specified.
        // * Fatal client error: disconnecting!
        // * chmod {filePath}: The system cannot find the file specified.
        //
        // Experience this myself once.
        // Only do it here and not on `download` as it would cause download twice.
        return this.preparing = del([path.resolve(packagePath, '**')], { force: true })
            .then(function () {
                return execp(syncCmd, me.execOptions);
            });
    }
};
