var pluginTypescript = require('gulp-typescript');
var pluginSourceMaps = require('gulp-sourcemaps');
var pluginConcat = require('gulp-concat');
var gulpUtil = require('gulp-util');
var pluginWebServer = require('gulp-webserver');
var pluginYargs = require('yargs').argv;
var pluginDel = require('del');
var pluginShell = require('gulp-shell');
var pluginCallback = require("gulp-callback");
var fs = require("fs");
var fsExtra = require("fs-extra");
var uuid = require('uuid');
var utils = require('./utils.js');

module.exports = function (gulpWrapper, ctx) {
    
    var gulp = gulpWrapper.gulp;
    var pluginRunSequence = gulpWrapper.seq;
    var typescriptCompilerPath = ctx.__repositoryRoot + '/node_modules/typescript/bin/tsc';
    var getDirectories = function (path, startsWith) {
        try {
            var directory = fs.readdirSync(path);
            return directory.filter(function (file) {                
                return fs.statSync(path + '/' + file).isDirectory() && file.startsWith(startsWith);
            });

        } catch (e) {
            return [];
        }
    };

    /**
     * Compile typescript files
     */
    gulp.task('build', function (cb) {
        return gulp.src('').pipe(pluginShell("node " + typescriptCompilerPath, { cwd: ctx.baseDir }));
    });

    gulp.task('deploy', function(cb){
        var deployPath = pluginYargs.path ? pluginYargs.path : process.env.BUILD_ARTIFACTSTAGINGDIRECTORY;

        if(pluginYargs.moduleName){
            deployPath += "\\" + pluginYargs.moduleName;
        }

        var tempFileName = ctx.baseDir + uuid.v4() + ".zip";

        // We need to go through all package.json of all cmf packages and update the relative paths to reflect a production environment.
        // Relative paths can't reference the dev environment as they will be all at the same level        
        console.log("Changing all package.json to reflect productive environment.");
        var foldersToChange = getDirectories(ctx.baseDir + ctx.libsFolder, ctx.packagePrefix), updateCounter = 0;
        if (foldersToChange instanceof Array && foldersToChange && foldersToChange.length > 0) {
            // Include the package.json in the app's root
            foldersToChange = foldersToChange.map(function(folder) { return { path: ctx.baseDir + ctx.libsFolder + folder + "/package.json", prefix: "file:../"};});
            foldersToChange.push({path: ctx.baseDir + "package.json"} );
            foldersToChange.forEach(function(folder) {                       
                var packageJSONObject = fsExtra.readJsonSync(folder.path), relativePath = "", isUpdatable = false;
                if (packageJSONObject && packageJSONObject.dependencies instanceof Object) {                                        
                    for (var property in packageJSONObject.dependencies) {
                        if (folder.prefix == null) {                        
                            delete packageJSONObject.dependencies[property]; // We can't allow the property in the app's package.json to follow, otherwise "npm i" will alter the release and it's pointless
                        } else if (typeof packageJSONObject.dependencies[property] === "string" && packageJSONObject.dependencies[property].startsWith("file:")) {                                                        
                            if (typeof folder.prefix === "string") {
                                packageJSONObject.dependencies[property]  = folder.prefix + property;    
                            }                             
                            if (property === "angular") {
                                packageJSONObject.dependencies[property]  = folder.prefix + "@angular";
                            }
                            isUpdatable = true;
                        }                        
                    }                    
                }
                if (isUpdatable === true) {
                    fsExtra.writeJsonSync(folder.path, packageJSONObject);    
                    updateCounter++;
                }                
            });
        }
        console.log(updateCounter + " files changed");
        
        if (!fs.existsSync(deployPath)){
            fs.mkdirSync(deployPath);
        }else{
            console.log("Deleting path " + deployPath + "\\**");
            pluginDel.sync([deployPath + "\\**", "!" + deployPath], { force: true });
        }

        gulp.src('').pipe(
            pluginShell(
                "\"C:\\Program Files\\7-Zip\\7z\" a "
                + tempFileName +
                //' -x!node_modules\\**\\node_modules' +
                ' -ir@"' + __dirname + '\\deploy\\web.deploy.include.txt"' +
                ' -xr@"' + __dirname + '\\deploy\\web.deploy.exclude.txt"' 
                , { cwd: ctx.baseDir })) // We could use gulp-typescript with src, but the declarations and sourceMaps are troublesome
                .pipe(  
                   pluginShell(
                        "\"C:\\Program Files\\7-Zip\\7z\" x "
                        + tempFileName +
                        //' -x!node_modules\\**\\node_modules' +
                        ' -o' + deployPath + " -y"
                        , { cwd: ctx.baseDir })
                ).pipe(pluginCallback(function () {     
                  pluginDel([tempFileName], cb)  
                }));
    });

    gulp.task('deploy-setup', function(cb){
        var deployPath = pluginYargs.path ? pluginYargs.path : process.env.BUILD_ARTIFACTSTAGINGDIRECTORY;
        var tokensFile = pluginYargs.appFileName ? pluginYargs.appFileName : "config.setup.json";

        if(pluginYargs.moduleName){
            deployPath += "\\" + pluginYargs.moduleName + ".zip";
        }

        // Change name
        pluginDel.sync(["config.json"]);
        fs.renameSync(tokensFile, "config.json");

        return gulp.src('').pipe(
            pluginShell(
                "\"C:\\Program Files\\7-Zip\\7z\" a "
                + deployPath +
                ' -ir@"' + __dirname + '\\deploy\\web.deploy.include.txt"' +
                ' -xr@"' + __dirname + '\\deploy\\web.deploy.exclude.txt"' 
                , { cwd: ctx.baseDir }));
                
    });

    /**
    * Clean all libs
    */
    gulp.task('clean-libs', function (cb) {
        pluginDel([ctx.baseDir + ctx.libsFolder + '**/*'], cb);
    });


    /**
     * Start application
     */
    gulp.task('start', function (cb) {
        pluginYargs.open = true;
        if (pluginYargs.production) {
            pluginYargs.port = ctx.defaultPort + 1;
            pluginRunSequence(['start-bundle-mode'], cb);
        } else {
            pluginYargs.port = ctx.defaultPort;
            pluginRunSequence(['start-dev-mode'], cb);
        }
    });

    gulp.task('start-dev-mode', function () {
        var __currentCulture = "en-US";

        if (pluginYargs.port === undefined) {

            pluginYargs.port = ctx.defaultPort;
            pluginYargs.open = true;
        }

        // Writes a repsonse with status OK 200
        function writeOK(res, content) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.write(content);
            res.end();
        }
                
        // We set the Core solution as the root for the app which already has the linkage 
        // to all the "src" module folders         
        var rootDir = ctx.baseDir;
        var stream = gulp.src(rootDir)
            .pipe(pluginWebServer({
                host: '0.0.0.0',
                port: pluginYargs.port,
                livereload: false,
                directoryListing: false,
                open: pluginYargs.open ? `http://localhost:${pluginYargs.port}/` : false,
                fallback: rootDir + 'index.html',
                middleware: function (req, res, next) {
                    var url = req.url.split("?").shift();

                    if (req.method == 'GET' && url.indexOf(".") < 0) {
                        // We request the initial index.html and we inject a global that will the app know it is in dev-mode, by default the application runs in bundle-mode
                        var indexContent = fs.readFileSync(ctx.baseDir + 'index.html').toString();
                        indexContent = indexContent.replace(new RegExp("<head>"), function (match) {
                            return match + "<script>__CMFInternal__DevMode=true;</script>";
                        });
                        firstRequest = false;
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.write(indexContent);
                        res.end();
                    } else if (req.method == 'GET' && url.endsWith("metadata.js")) {
                        var urlArray = url.split("/");
                        if (urlArray[urlArray.length - 1] !== "metadata.js") {
                            // Let's check which module we are searching
                            var metadataFileName = urlArray[urlArray.length - 1];
                            var moduleName = metadataFileName.replace(".metadata.js", "");
                            // Get the proper metadata file
                            var metadataContent = fs.readFileSync(ctx.baseDir + "node_modules/" + moduleName + "/src/" + metadataFileName).toString();                                             
                            var bundlerFoldersObj = { "components": [], "directives": [], "pipes": [], "widgets": [], "dataSources": [], "converters": [] };
                            for (var bundleName in bundlerFoldersObj) {
                                // There has to be a better way
                                metadataContent = metadataContent.replace(new RegExp(bundleName + "\: \[[\\s\\S]*?\],"), function (match) {                                    
                                    bundlerFoldersObj[bundleName] = utils.fs.getDirectories(ctx.baseDir + "node_modules/" + moduleName + "/src/" + bundleName);
                                    return bundleName + ": [" +
                                        bundlerFoldersObj[bundleName].map(function (entry) { return "'" + entry + "'" }) + "],";
                                });
                            };
                            // After all bundle folders are processed, then we can move to the i18n resources which may be available in all bundle folders
                            var partiali18nContent = "";
                            var isFirst = true;
                            for (var bundleName in bundlerFoldersObj) {                                
                                bundlerFoldersObj[bundleName].forEach(function(folder) {
                                    var i18nFolder = bundleName + "/" + folder + "/i18n/";
                                    if (utils.fs.isDirectory(ctx.baseDir + "node_modules/" + moduleName + "/src/" + i18nFolder)) {
                                        partiali18nContent += ((isFirst) ? "" : ",") + "'" + i18nFolder + folder + ".default'";
                                        isFirst = false;
                                    }                                    
                                });                                
                            };                            
                            if (partiali18nContent !== "") {
                                metadataContent = metadataContent.replace(new RegExp("i18n\: \[[\\s\\S]*?\],"), function (match) {                                                                    
                                    return "i18n: [" + partiali18nContent + "],";
                                });
                            }
                            // Also de metadata file normally asks for the module's main i18n resource by using the "./i18n/main.default". We need to replace this dependency with "cmf.core.shell/src/i18n/i18n"
                            metadataContent = metadataContent.replace("./i18n/main.default", moduleName + "/src/i18n/main.default");
                            writeOK(res, metadataContent);                            
                        } else {
                            next();
                        }
                    } else {
                        next();
                    }
                }

            }));
    });

    

    gulp.task('start-bundle-mode', function () {

        if (pluginYargs.port === undefined) {
            pluginYargs.port = 8001;
            pluginYargs.open = true;
        }

        //var webserver = require('gulp-webserver');
        var stream = gulp.src(ctx.baseDir)
            .pipe(pluginWebServer({
                port: pluginYargs.port,
                livereload: false,
                directoryListing: false,
                open: pluginYargs.open,
                fallback: 'index.html'
            }));
    });


};