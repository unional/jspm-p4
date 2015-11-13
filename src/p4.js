var crypto = require('crypto');
var path = require('path');
var exec = require('child_process').exec;

var Promise = require('rsvp').Promise;
var asp = require('rsvp').denodeify;
var fs = require('graceful-fs');
var ncp = require('ncp');
var semverRegex = require('semver-regex');

var isWindows = process.platform.match(/^win/);

// This is needed to support corner case where current directory has a `p4.*` (e.g. `p4.js`) file.
// Windows cmd.exe will try to open that file instead of invoking p4.exe.
var p4cmd = isWindows? 'p4.exe -c ' : 'p4 -c ';
var execp = asp(exec);
var ncpp = asp(ncp);

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
            .then(function (stdout, stderr) {
                if (stderr) {
                    throw stderr;
                }

                var lines = stdout.split('\n');
                var versions = {};
                for (var i = 0, len = lines.length; i < len; i++) {
                    var line = lines[i];
                    var version = semverRegex().exec(line);
                    if (version) {
                        versions[version] = {
                            hash: crypto.createHash('sha1').update(packageName + line).digest('hex')
                        };
                    }
                }

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
        var p4PackagePath = path.resolve(packagePath, '...');

        return execp(p4cmd + me.options.workspace + ' sync -f ' + p4PackagePath + '@' + version, me.execOptions)
            .then(function () {
                return ncpp(packagePath, dir, me.execOptions);
            })
            .then(function () {
                return execp(isWindows ? 'attrib -R /S ' + dir + '\\*' : 'chmod -R +w ' + dir + '/*');
            })
            .then(function () {
                var filepath = path.resolve(packagePath, 'package.json');
                // console.log(filepath);
                return asp(fs.readFile)(filepath);

            })
            .then(function (pjson) {
                pjson = JSON.parse(pjson.toString());
                // console.log(pjson);
                return pjson;
            });
    },
    getPackageConfig: function(packageName, version, hash, meta) {
        // console.log('getPackageConfig', packageName, version, hash, meta);
        var me = this;
        var root = path.resolve(this.options.registryPath);
        var packagePath = path.resolve(root, packageName);
        var p4PackagePath = path.resolve(packagePath, '...');

        return execp(p4cmd + me.options.workspace + ' sync -f ' + p4PackagePath + '@' + version, me.execOptions)
            .then(function () {
                var filepath = path.resolve(packagePath, 'package.json');
                return asp(fs.readFile)(filepath);

            })
            .then(function (pjson) {
                pjson = JSON.parse(pjson.toString());
                return pjson;
            });
    }
};
