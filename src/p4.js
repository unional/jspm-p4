var Promise = require('rsvp').Promise;
var asp = require('rsvp').denodeify;
var fs = require('graceful-fs');
var exec = require('child_process').exec;
var semver = require('semver');
var semveRegex = require('semver-regex');
var path = require('path');
var rimraf = require('rimraf');
// var P4rc = require('./p4rc.js');

function clone(a) {
  var b = {};
  for (var p in a) {
    if (a[p] instanceof Array)
      b[p] = [].concat(a[p]);
    else if (typeof a[p] == 'object')
      b[p] = clone(a[p]);
    else
      b[p] = a[p];
  }
  return b;
}

// Set default repo to the parent folder. Assuming default folder structure is simple flatten module as in npm@3+
var defaultConfig = {
    registryPath: "../.."
};

/**
* Create a Perforce registry
* @param {object} options Options from jspm (config?). Can contain any other registry-specific config.
* @param {string} options.tmpDir Path to a folder the registry can use to store temporary files. This folder persists and is shared between installs.
* @param {string} options.versionString Represents the minor and major version of the registry package, which is used in the caching hash of packages. This can be altered and written to the instance allowing for custom registry cache invalidation - `this.versionString = options.versionString + '.53'``.
* @param {object} ui      Accessing the ui (console)
*/
var P4Registry = module.exports = function P4Registry(options, ui) {
    this.ui = ui;
    this.options = options;

    this.execOptions = {
      timeout: options.timeout * 1000,
      killSignal: 'SIGKILL'
    };
};

P4Registry.configure = function configure(config, ui) {
    return Promise.resolve()
    .then(function() {
        return ui.input('p4 local registry path', config.registryPath || defaultConfig.registryPath);
    })
    .then(function(registryPath) {
        if (registryPath != defaultConfig.registryPath) {
            config.registryPath = registryPath;
        }
    })
    .then(function () {
        return config;
    });
};

P4Registry.packageFormat = /^@[^\/]+\/[^\/]+|^[^@\/][^\/]+/;

P4Registry.prototype = {
    // /**
    // * Given a package name, locate it and ensure it exists.
    // * @param  {string} packageName Name of the package
    // * @return {Promise}  Promise { notfound: true } | { redirect: 'new:package' } / undefined
    // */
    // locate: function(packageName) {
    //     // packageName = 'owner/repo'
    //     var root = this.root;
    //
    //     if (repo.split('/').length !== 2) {
    //         throw new Error("Perforce packages must be organized in the form of `owner(team)/repo`.");
    //     }
    //
    //     return new Promise(function(resolve, reject) {
    //         var stat = fs.statSync(root + "/" + packageName);
    //         if (stat.isDirectory()) {
    //             resolve()
    //         }
    //         else {
    //             resolve({ notfound: true});
    //         }
    //     });
    // },
    lookup: function(packageName) {
        var root = path.resolve(this.options.registryPath || defaultConfig.registryPath);
        var packagePath = path.resolve(root, packageName);
        var latestKey = 'latest';
        var me = this;
        if (packageName.split('/').length !== 2) {
            throw new Error("Perforce packages must be organized in the form of `owner(team)/repo`.");
        }

        return asp(fs.readFile)(path.resolve(this.options.tmpDir, packageName + '.json'))
        .then(function(lookupJSON) {
            lookupCache = JSON.parse(lookupJSON.toString());
        })
        .catch(function(e) {
            if (e.code === 'ENOENT' || e instanceof SyntaxError) {
                return;
            }
            throw e;
        })
        .then(function() {
            // load labels from p4
            // `p4 labels ...`
            console.log('before');
            return asp(exec)('p4 labels ...', me.execOptions)
            .then(function(stdout, stderr) {
                var versions = stdout.match(semverRegex());
                console.log(versions);
                if(stderr) {
                    throw stderr;
                }
                return stdout;
            })
            .catch(function(err) {
                console.log(err);
                if (typeof err === 'string') {
                    err = new Error(err);
                    err.hideStack = true;
                }
                err.retriable = true;
                throw err;
            })
            .then(function() {
                return {
                    versions: {
                        '0.1.0': {
                            hash: 'asdf'
                        }
                    },
                    latest: '0.1.0'
                };
            });
        })
        .then(function(response) {
            // todo save lookupCache
            return response;
        });
    },
    download: function(packageName, version, hash, meta, dir) {

        return Promise.resolve({ notfound: true});
    }
    // parse: function parse(name) {
    //     var parts = name.split('/');
    //     if (parts.length !== 2) {
    //         throw new Error("Perforce packages must be organized in the form of `owner(team)/repo`.");
    //     }
    //
    //     return {
    //         package: parts[0],
    //         path: parts.splice(1).join('/')
    //     };
    // },
    // updateRegistry: function updateRegistry() {
    //     if (this.updatePromise_)
    //     return Promise.resolve(this.updatePromise_);
    //
    //     var ui = this.ui;
    //     var registryPath = this.registryPath;
    //     var remoteString = this.repo;
    //     var execOptions = this.execOptions;
    //     var self = this;
    //
    //     return this.updatePromise_ = asp(exec)('git remote show origin -n', execOptions)
    //     .then(function(output) {
    //         output = output.toString();
    //
    //         var curRepoMatch = output.match(/Fetch URL: ([^\n]+)/m);
    //
    //         if (!curRepoMatch || curRepoMatch[1] != self.repo)
    //         return self.createRegistry();
    //
    //         // if the registry does exist, update it
    //         ui.log('info', 'Updating registry cache...');
    //         return asp(exec)('git fetch --all && git reset --hard origin/master', execOptions)
    //         .then(function(stdout, stderr) {
    //             if (stderr)
    //             throw stderr;
    //         })
    //         .catch(function(err) {
    //             if (typeof err == 'string') {
    //                 err = new Error(err);
    //                 err.hideStack = true;
    //             }
    //             err.retriable = true;
    //             throw err;
    //         });
    //     }, function(err) {
    //         err = err.toString();
    //
    //         // if the registry does not exist, do a git clone
    //         if (err.indexOf('Not a git repo') != -1)
    //         return self.createRegistry();
    //     })
    //     .then(function() {
    //         return asp(fs.readFile)(path.resolve(registryPath, 'registry.json'))
    //         .then(function(pjson) {
    //             try {
    //                 return JSON.parse(pjson);
    //             }
    //             catch(e) {
    //                 return {};
    //             }
    //         }, function(err) {
    //             if (err.code === 'ENOENT')
    //             return {};
    //             ui.log('warn', 'Registry file is invalid.');
    //         });
    //     })
    //     .then(function(json) {
    //         return json;
    //     });
    // }
};
