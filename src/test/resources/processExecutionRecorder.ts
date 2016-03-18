// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import * as child_process from "child_process";
import * as events from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface IExecOptions {
    cwd?: string;
    stdio?: any;
    env?: any;
    encoding?: string;
    timeout?: number;
    maxBuffer?: number;
    killSignal?: string;
}

interface ISpawnOptions {
    cwd?: string;
    stdio?: any;
    env?: any;
    detached?: boolean;
}

import {ITimedEvent,
    IEventArguments,
    ProcessExecutionRecording,
    IAndroidDevice,
    IIOSDevice,
    ISpawnArguments,
} from "./processExecutionEvents";

/* We use this class to capture the behavior of a ChildProces running inside of node, so we can store all the
   visible events and side-effects of that process, and then we can perfectly reproduce them in a test by using
   the ProcessExecutionSimulator class */
export class ProcessExecutionRecorder {
    private static originalSpawn: (command: string, args: string[], options: ISpawnOptions) => child_process.ChildProcess;

    private recording: ProcessExecutionRecording;
    private previousEventTimestamp: number;

    public static installGlobalRecorder(): void {
        if (!this.originalSpawn) {
            this.originalSpawn = child_process.spawn;
            child_process.spawn = this.recordAndSpawn.bind(this);
        }
    }

    public static recordAndSpawn(command: string, args?: string[], options: ISpawnOptions = {}): child_process.ChildProcess {
        const spawnedProcess = this.originalSpawn(command, args, options);
        new ProcessExecutionRecorder(spawnedProcess, { command, args, options }).record();
        return spawnedProcess;
    }

    constructor(private processExecution: child_process.ChildProcess, spawnArguments: ISpawnArguments,
                private filePath = ProcessExecutionRecorder.defaultFilePath()) {
        this.initializeRecording(spawnArguments);
    }

    public record(): void {
        this.recordEvent(this.processExecution.stdout, "stdout", "data", "data", data => data.toString());
        this.recordEvent(this.processExecution.stderr, "stderr", "data", "data", data => data.toString());
        this.recordEvent(this.processExecution, "error", "error", "error");
        this.recordEvent(this.processExecution, "exit", "exit", "code");
        this.processExecution.on("error", () =>
            this.store());
        this.processExecution.on("exit", () =>
            this.store());
        this.previousEventTimestamp = this.now();
    }

    private initializeRecording(spawnArguments: ISpawnArguments): void {
        this.recording = {
            title: "TBD",
            arguments: spawnArguments,
            date: new Date(),
            configuration: {
                os: { platform: os.platform(), release: os.release() },
                android: {
                    sdk: { tools: "TBD", platformTools: "TBD", buildTools: "TBD", repositoryForSupportLibraries: "TBD" },
                    intelHAXMEmulator: "TBD",
                    visualStudioEmulator: "TBD",
                },
                reactNative: "TBD",
                node: "TBD",
                npm: "TBD",
            },
            state: {
                reactNative: { packager: "TBD" },
                devices: { android: <IAndroidDevice[]>[], ios: <IIOSDevice[]>[] },
            },
            events: <IEventArguments[]>[],
        };
    }

    private static defaultFilePath(): string {
        return path.join(os.tmpdir(), "processExecutionRecording.txt");
    }

    private now(): number {
        return new Date().getTime();
    }

    private recordEvent(emitter: events.EventEmitter, storedEventName: string, eventToListenName: string,
                        argumentName: string, argumentsConverter: (value: any) => any = value => value): void {
        emitter.on(eventToListenName, (argument: any) => {
            const now = this.now();
            const relativeTimestamp = now - this.previousEventTimestamp;
            this.previousEventTimestamp = now;
            this.recording.events.push(this.generateEvent(relativeTimestamp, storedEventName, argumentName, argumentsConverter(argument)));
        });
    }

    private generateEvent(relativeTimestamp: number, eventName: string, argumentName: string, argument: any): IEventArguments {
        const event: ITimedEvent = { after: relativeTimestamp };
        (<any>event)[eventName] = this.generateEventArguments(argumentName, argument);
        return <IEventArguments>event;
    }

    private generateEventArguments(argumentName: string, argument: any): IEventArguments {
        const eventArguments: IEventArguments = <IEventArguments>{};
        (<any>eventArguments)[argumentName] = argument;
        return eventArguments;
    }

    private store(): void {
        fs.appendFileSync(this.filePath, JSON.stringify(this.recording) + "\n\n\n", "utf8");
    }
}