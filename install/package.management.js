var fs = require("fs"),
	pluginRename = require('gulp-rename'), 
	pluginDel = require("del"), 
	pluginExecute = require("child_process").exec,	
	pluginfsExtra = require("fs-extra"),
	pluginPath = require('path'),
	pluginYargs = require('yargs').argv;;

module.exports = function (gulpWrapper, ctx) {	
    var gulp = gulpWrapper.gulp, seq = gulpWrapper.seq, getDirectories = function (path) {
		try {
			var directory = fs.readdirSync(path);
            return directory.filter(function (file) {
                return fs.statSync(path + '/' + file).isDirectory();
            });
		} catch (e) {return [];}
	};

	/**
     * Removes stale files and directories. After this a new install is required.
     */
    gulp.task('purge', function (callback) {
        pluginDel([            
            ctx.baseDir + ctx.libsFolder,
            ctx.baseDir + ctx.metadataFileName,
            ctx.baseDir + "obj",
            ctx.baseDir + "bin"], { force: true }, callback);
    });

	/**
	 * Cleans the libs folder allowing a cleaning install.
	 * There is an exception here, which is the webApp for customized projects. We can't delete the libs folder as we would be removing the HTML5 release.
	 */
	gulp.task('__cleanLibs',  function (callback) {	
		if (ctx.isCustomized !== true || (ctx.isCustomized === true && ctx.type !== "webApp")) {	    		
			pluginDel.sync([ctx.baseDir + ctx.libsFolder], { force: true });	
		}
		callback();
	}); 

    /*
    * Installs all npm packages
    */ 
    gulp.task('__npmInstall',  function(callback) {	
		try {	
	    	process.chdir(ctx.baseDir);
			// Should be the other way arround
			pluginExecute('npm install --only=production', callback);
		} catch(ex) {
			console.error(ex);
			callback();
		}
	}); 

	/*
	* If there is a "local-typings" folder, then the typings inside are not available in their own npm packages or in the npm @types repository.
	* So we copy each one to the according package. The ts compiler will pick it up there being called index.d.ts.
	*/
	gulp.task('__copyLocalTypings', function (callback) {
		var promise = Promise.resolve(null);
    	try {
	    	// If we have an i18n module file we generate the bundle, otherwise, we skip it	    	
			if (fs.lstatSync(ctx.baseDir + "local-typings").isDirectory()) {
				var folders = getDirectories(ctx.baseDir + "local-typings");			
				if (folders instanceof Array) {
					var promiseArray = [];
					folders.forEach(function(folder) {
						// Check if folder already exists
						try {
							if (fs.lstatSync(ctx.baseDir + ctx.libsFolder + folder).isDirectory()) {								
								promiseArray.push(gulp.src([ctx.baseDir + "local-typings/" + folder + "/" + folder + ".d.ts"])
						    		.pipe(pluginRename("index.d.ts"))				    
						    		.pipe(gulp.dest(ctx.baseDir + ctx.libsFolder + folder + "/")));
							}
						} catch(error){
							//folder does not exist
						}
					});
					if (promiseArray.length > 0) {
						promise = Promise.all(promiseArray);
					}
				}			
	        } 
    	} catch(error){
			//folder does not exist
		}
        return promise;			
	});

	/**
	 * Recursively follows all dependencies defined in the cmfLinkDependencies object of the package.json. All nested dependencies get linked.
	 */
	gulp.task('__linkDependencies',  function (callback) {	
	    try {	
			var packagesToLink = [];
			(function createLinks(packagesToLink, packageFolder) {
				const packageObj = pluginfsExtra.readJsonSync(packageFolder + '/package.json');
				if (typeof packageObj.cmfLinkDependencies === "object") {
					Object.getOwnPropertyNames(packageObj.cmfLinkDependencies).forEach(function(dependencyName) {
						const package = { name: dependencyName, path: pluginPath.join(packageFolder, packageObj.cmfLinkDependencies[dependencyName].split("file:").pop()) };
						packagesToLink.push(package);
						createLinks(packagesToLink, package.path);
					})
				}
			})(packagesToLink, ctx.baseDir);
			if (packagesToLink.length > 0) {
				// We need to delete the folder, otherwise the link won't come through
				if (ctx.isCustomized !== true || (ctx.isCustomized === true && ctx.type !== "webApp")) {	    		
					pluginDel.sync(packagesToLink.map((package) => ctx.baseDir + ctx.libsFolder + package.name), { force: true });	
				}			
				pluginExecute(packagesToLink.map((package)=>`mklink /j ${package.name} "${package.path}"`).join(" & "), { cwd: ctx.baseDir + ctx.libsFolder });	
				console.log(`${packagesToLink.length} packages linked.`);				
			}
			callback();
		} catch(ex) {
			console.error(ex);
			callback();
		}		
	}); 

     /**
     * Installation Task
     * Remarks: only needs to be run the first time or after a git pull
     */
    gulp.task('install', function (callback) {
		var taskArray = ['__npmInstall', '__copyLocalTypings', '__linkDependencies'];
		if (pluginYargs.clean) {
			taskArray.unshift('__cleanLibs');
		}
		// The best approach would be linking first and then make an "npm -i" but there is a bug on npm that steals the dependencies packages, so for instance, it would steal lbo's moment when installing cmf.core. We do it the other way arround to prevent this bug (https://github.com/npm/npm/issues/10343)
		seq(taskArray, callback);		
	});
};