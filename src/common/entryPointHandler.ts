// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.


import {ErrorHelper} from "../common/error/errorHelper";
import {InternalError} from "../common/error/internalError";
import {TelemetryHelper} from "../common/telemetryHelper";
import {Telemetry} from "../common/telemetry";
import {Log} from "../common/log/log";
import {ILogger} from "../common/log/loggers";

/* This class should we used for each entry point of the code, so we handle telemetry and error reporting properly */
export class EntryPointHandler {
    private isDebugeeProcess: boolean;

    constructor(isDebugeeProcess: boolean = false, logger?: ILogger) {
        if (logger) {
            Log.SetGlobalLogger(logger);
        }

        this.isDebugeeProcess = isDebugeeProcess;
    }


    /* This method should wrap any async entry points to the code, so we handle telemetry and error reporting properly */
    public runFunction(taskName: string, error: InternalError, codeToRun: () => Q.Promise<void> | void, errorsAreFatal: boolean = false): void {
        return this.handleErrors(error, TelemetryHelper.generate(taskName, codeToRun), /*errorsAreFatal*/ errorsAreFatal);
    }

    // This method should wrap the entry point of the whole app, so we handle telemetry and error reporting properly
    public runApp(appName: string, getAppVersion: () => string, error: InternalError, codeToRun: () => Q.Promise<void>): void {
        try {
            Telemetry.init(appName, getAppVersion(), {isExtensionProcess: !this.isDebugeeProcess});
            return this.runFunction(appName, error, codeToRun, true);
        } catch (error) {
            Log.logError(error, false);
            throw error;
        }
    }

    private handleErrors(error: InternalError, resultOfCode: Q.Promise<void>, errorsAreFatal: boolean): void {
        resultOfCode.done(() => { }, reason => {
            const shouldLogStack = !errorsAreFatal || this.isDebugeeProcess;
            Log.logError(ErrorHelper.wrapError(error, reason), /*logStack*/ shouldLogStack);
            // For the debugee process we don't want to throw an exception because the debugger
            // will appear to the user if he turned on the VS Code uncaught exceptions feature.
            if (errorsAreFatal) {
                if (this.isDebugeeProcess) {
                    process.exit(1);
                } else {
                    throw reason;
                }
            }
        });
    }
}