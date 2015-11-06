# jspm-p4
jspm registry endpoint for Perforce.

# Usage
````
npm install jspm-p4
jspm registry create myEndpoint jspm-p4
jspm registry config myEndpoint
````

`jspm-p4` relies on `p4 labels ...` to manage versions. Similar to what you need to do on git/GitHub, after you have a module that is ready to consume, do the following:
1. Update version in `package.json`
2. Tag the specific `revision/changelist` with a `label` that follows the `semver` convention (and create the label if needed).

To avoid unexpected behavior/**mess ups**, do not submit change from multiple modules in the same revision. Check them in separately. That's the right thing to do anyway.

# Design Direction
* Perforce is a centralized VCS, and it works with a workspace concept. So to use it as a registry, I need to rely on a local repo for a registry namespace.  This is similar to the approach of git-p4.
* Perforce label can be applied to multiple revisions, so to create a unique hash for each package and versions, I use the hash of `packageName + label`.
