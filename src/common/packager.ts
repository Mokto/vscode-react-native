// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import {ChildProcess} from "child_process";
import {CommandExecutor} from "./commandExecutor";
import {ErrorHelper} from "./error/errorHelper";
import {Log} from "./log/log";
import {LogLevel} from "./log/logHelper";
import {Node} from "./node/node";
import {Package} from "./node/package";
import {PromiseUtil} from "./node/promise";
import {Request} from "./node/request";

import * as Q from "q";
import * as path from "path";

export class Packager {
    // TODO: Make the port configurable via a launch argument
    public static PORT = "8081";
    public static HOST = `localhost:${Packager.PORT}`;

    private projectPath: string;
    private packagerProcess: ChildProcess;

    private static JS_INJECTOR_FILENAME = "opn-main.js";
    private static JS_INJECTOR_FILEPATH = path.resolve(path.dirname(path.dirname(__dirname)), "js-patched", Packager.JS_INJECTOR_FILENAME);
    private static NODE_MODULES_FODLER_NAME = "node_modules";
    private static OPN_PACKAGE_NAME = "opn";
    private static REACT_NATIVE_PACKAGE_NAME = "react-native";
    private static OPN_PACKAGE_MAIN_FILENAME = "index.js";

    constructor(projectPath: string) {
        this.projectPath = projectPath;
    }


    public start(): Q.Promise<void> {
        let executedStartPackagerCmd = false;
        return this.isRunning()
            .then(running => {
                if (!running) {
                    executedStartPackagerCmd = true;
                    return this.monkeyPatchOpnForRNPackager()
                        .then(() => {
                            let args = ["--port", Packager.PORT];
                            let childEnvForDebugging = Object.assign({}, process.env, { REACT_DEBUGGER: "echo A debugger is not needed: " });

                            Log.logMessage("Starting Packager");
                            // The packager will continue running while we debug the application, so we can"t
                            // wait for this command to finish

                            let spawnOptions = { env: childEnvForDebugging };

                            const packagerSpawnResult = new CommandExecutor(this.projectPath).spawnReactPackager(args, spawnOptions);
                            this.packagerProcess = packagerSpawnResult.spawnedProcess;
                            packagerSpawnResult.outcome.done(() => {}, () => {}); /* Q prints a warning if we don't call .done().
                                                                                     We ignore all outcome errors */
                            return packagerSpawnResult.startup;
                        });
                }
            })
            .then(() =>
                this.awaitStart())
            .then(() => {
                if (executedStartPackagerCmd) {
                    Log.logMessage("Packager started.");
                } else {
                    Log.logMessage("Packager is already running.");
                    if (!this.packagerProcess) {
                        Log.logWarning(ErrorHelper.getWarning("Debugging is not supported if the React Native Packager is not started within VS Code. If debugging fails, please kill other active React Native packager processes and retry."));
                    }
                }
            });
    }

    public stop(): Q.Promise<void> {
        return this.isRunning()
            .then(running => {
            if (running) {
                if (!this.packagerProcess) {
                    Log.logWarning(ErrorHelper.getWarning("Packager is still running. If the packager was started outside VS Code, please quit the packager process using the task manager."));
                    return Q.resolve(void 0);
                }

                return new CommandExecutor(this.projectPath).killReactPackager(this.packagerProcess).then(() =>
                    this.packagerProcess = null);
            } else {
                Log.logWarning(ErrorHelper.getWarning("Packager is not running"));
                return Q.resolve(void 0);
            }
        });
    }

    public prewarmBundleCache(platform: string) {
        let bundleURL = `http://${Packager.HOST}/index.${platform}.bundle`;
        Log.logInternalMessage(LogLevel.Info, "About to get: " + bundleURL);
        return new Request().request(bundleURL, true).then(() => {
            Log.logMessage("The Bundle Cache was prewarmed.");
        }).catch(() => {
            // The attempt to prefetch the bundle failed.
            // This may be because the bundle is not index.* so we shouldn't treat this as fatal.
        });
    }

    private isRunning(): Q.Promise<boolean> {
        let statusURL = `http://${Packager.HOST}/status`;

        return new Request().request(statusURL)
            .then((body: string) => {
                return body === "packager-status:running";
            },
            (error: any) => {
                return false;
            });
    }

    private awaitStart(retryCount = 30, delay = 2000): Q.Promise<boolean> {
        let pu: PromiseUtil = new PromiseUtil();
        return pu.retryAsync(() => this.isRunning(), (running) => running, retryCount, delay, "Could not start the packager.");
    }

    private findOpnPackage(): Q.Promise<string> {
        try {
            let flatDependencyPackagePath = path.resolve(this.projectPath, Packager.NODE_MODULES_FODLER_NAME,
                Packager.OPN_PACKAGE_NAME, Packager.OPN_PACKAGE_MAIN_FILENAME);

            let nestedDependencyPackagePath = path.resolve(this.projectPath, Packager.NODE_MODULES_FODLER_NAME,
                Packager.REACT_NATIVE_PACKAGE_NAME, Packager.NODE_MODULES_FODLER_NAME, Packager.OPN_PACKAGE_NAME, Packager.OPN_PACKAGE_MAIN_FILENAME);

            let fsHelper = new Node.FileSystem();

            // Attempt to find the 'opn' package directly under the project's node_modules folder (node4 +)
            // Else, attempt to find the package within the dependent node_modules of react-native package
            let possiblePaths = [flatDependencyPackagePath, nestedDependencyPackagePath];
            return Q.any(possiblePaths.map(path =>
                fsHelper.exists(path).then(exists =>
                    exists
                        ? Q.resolve(path)
                        : Q.reject<string>("opn package location not found"))));
        } catch (err) {
            console.error("The package \'opn\' was not found." + err);
        }
    }

    private monkeyPatchOpnForRNPackager(): Q.Promise<void> {
        let opnPackage: Package;
        let destnFilePath: string;

        // Finds the 'opn' package
        return this.findOpnPackage()
            .then((opnIndexFilePath) => {
                destnFilePath = opnIndexFilePath;
                // Read the package's "package.json"
                opnPackage = new Package(path.resolve(path.dirname(destnFilePath)));
                return opnPackage.parsePackageInformation();
            }).then((packageJson) => {
                if (packageJson.main !== Packager.JS_INJECTOR_FILENAME) {
                    // Copy over the patched 'opn' main file
                    return new Node.FileSystem().copyFile(Packager.JS_INJECTOR_FILEPATH, path.resolve(path.dirname(destnFilePath), Packager.JS_INJECTOR_FILENAME))
                        .then(() => {
                            // Write/over-write the "main" attribute with the new file
                            return opnPackage.setMainFile(Packager.JS_INJECTOR_FILENAME);
                        });
                }
            });
    }
}