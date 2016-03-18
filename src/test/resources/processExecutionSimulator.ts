// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import * as Q from "q";
import * as assert from "assert";
import * as child_process from "child_process";
import * as stream from "stream";
import * as events from "events";

import {ISpawnResult, ChildProcess} from "../../common/node/childProcess";
import {PromiseUtil} from "../../common/node/promise";

import {IStdOutEvent, IStdErrEvent, IErrorEvent, IExitEvent, ICustomEvent} from "./processExecutionEvents";
import * as processExecutionEvents from "./processExecutionEvents";

export type IEventArguments = processExecutionEvents.IEventArguments;
export type ProcessExecutionRecording = processExecutionEvents.ProcessExecutionRecording;

export interface ISimulationResult {
    simulatedProcess: child_process.ChildProcess;
    simulationEnded: Q.Promise<void> | void;
}

class FakeStream extends events.EventEmitter {

}

/* We use this class to replay the events that we captured from a real execution of a process, to get
    the best possible simulation of that processes for our tests */
class FakeChildProcess extends events.EventEmitter implements child_process.ChildProcess {
    public stdin: stream.Writable = <stream.Writable>new FakeStream();
    public stdout: stream.Readable = <stream.Readable>new FakeStream();
    public stderr: stream.Readable = <stream.Readable>new FakeStream();
    public pid: number;

    public kill(signal?: string): void {

    }
    public send(message: any, sendHandle?: any): void {

    }
    public disconnect(): void {

    }
    public unref(): void {

    }
}

export interface IWholeOutputBasedSideEffectDefinition {
    wholeOutputPattern: RegExp;
    action: () => Q.Promise<void>;
}

export interface IOutputSingleEventBasedSideEffectDefinition {
    eventPattern: RegExp;
    action: () => Q.Promise<void>;
}

type IOutputBasedSideEffectDefinition = IOutputSingleEventBasedSideEffectDefinition | IWholeOutputBasedSideEffectDefinition;

export interface ISideEffectsDefinition {
    beforeStart: () => Q.Promise<void>;
    outputBased: IOutputBasedSideEffectDefinition[];
    beforeSuccess: (stdout: string, stderr: string) => Q.Promise<void>;
}

export class ProcessExecutionSimulator {
    private process = new FakeChildProcess();

    private allSimulatedEvents: IEventArguments[] = [];
    private allStdout = "";
    private allStderr = "";

    private wholeOutputBasedDefinitions: IWholeOutputBasedSideEffectDefinition[];
    private outputEventBasedDefinitions: IOutputSingleEventBasedSideEffectDefinition[];

    constructor(private sideEffectsDefinition: ISideEffectsDefinition) {
        this.outputEventBasedDefinitions = <IOutputSingleEventBasedSideEffectDefinition[]>this.sideEffectsDefinition.outputBased.filter(definition =>
            !this.isWholeOutputDefinition(definition));
        this.wholeOutputBasedDefinitions = <IWholeOutputBasedSideEffectDefinition[]>this.sideEffectsDefinition.outputBased.filter(definition =>
            this.isWholeOutputDefinition(definition));
    }

    public spawn(): ISpawnResult {
        const fakeChildProcessModule = <typeof child_process><any>{
            spawn: () => {
                return this.process;
            },
        };

        return new ChildProcess({ childProcess: fakeChildProcessModule }).spawnWaitUntilFinished("", []);
    }

    public simulate(recording: ProcessExecutionRecording): Q.Promise<void> {
        assert(recording, "recording shouldn't be null");
        return this.sideEffectsDefinition.beforeStart().then(() => {
            return this.simulateAllEvents(recording.events);
        });
    }

    public simulateAllEvents(events: IEventArguments[]): Q.Promise<void> {
        return new PromiseUtil().reduce(events, (event: IEventArguments) => this.simulateSingleEvent(event));
    }

    public getAllSimulatedEvents(): IEventArguments[] {
        return this.allSimulatedEvents;
    };

    private isWholeOutputDefinition(definition: IOutputBasedSideEffectDefinition): boolean {
        return definition.hasOwnProperty("wholeOutputPattern");
    }

    private simulateOutputSideEffects(data: string, previousOutputLength: number): Q.Promise<void> {
        const applicableSideEffectDefinitions: { index: number, definition: IOutputBasedSideEffectDefinition }[] = [];

        this.outputEventBasedDefinitions.forEach(definition => {
            const match = data.match(definition.eventPattern);
            if (match) {
                applicableSideEffectDefinitions.push({
                    index: previousOutputLength + match.index, // Index relative to the whole output
                    definition: definition,
                });
            }
        });

        /* We add the elements that match the whole output to applicableSideEffectDefinitions, and we remove them
            from future iterations of wholeOutputBasedDefinitions so they won't be matched again. */
        this.wholeOutputBasedDefinitions = this.wholeOutputBasedDefinitions.filter(definition => {
            const match = this.allStdout.match(definition.wholeOutputPattern);
            if (match) {
                applicableSideEffectDefinitions.push({
                    index: match.index,
                    definition: definition,
                });
                return false; // We've just matched the output. Remove it from future iterations of wholeOutputBasedDefinitions
            }

            return true; // We didn't match yet, keep it for future iterations of wholeOutputBasedDefinitions
        });

        // Sort by index, so the action matching the earlier text gets executed first
        applicableSideEffectDefinitions.sort((a, b) => a.index - b.index);

        return new PromiseUtil().reduce(applicableSideEffectDefinitions, definition => definition.definition.action());
    }

    private simulateSingleEvent(event: IEventArguments): Q.Promise<void> {
        /* TODO: Implement proper timing logic based on return Q.delay(event.at).then(() => {
            using sinon fake timers to simulate time passing */
        return Q.delay(0).then(() => {
            this.allSimulatedEvents.push(event);
            const key = Object.keys(event).find(eventKey => eventKey !== "after"); // At the moment we are only using a single key/parameter per event
            let result = Q<void>(void 0);
            switch (key) {
                case "stdout": {
                    const data = (<IStdOutEvent>event).stdout.data;
                    const previousOutputLength = this.allStdout.length;
                    this.allStdout += data;
                    result = this.simulateOutputSideEffects(data, previousOutputLength).then(() => {
                        this.process.stdout.emit("data", new Buffer(data));
                    });
                    break;
                }
                case "stderr": {
                    const data = (<IStdErrEvent>event).stderr.data;
                    this.allStderr += data;
                    this.process.stderr.emit("data", new Buffer(data));
                    break;
                }
                case "error":
                    this.process.emit("error", (<IErrorEvent>event).error.error);
                    break;
                case "exit":
                    const code = (<IExitEvent>event).exit.code;

                    let beforeFinishing = Q<void>(void 0);
                    if (code === 0) {
                        beforeFinishing = Q(this.sideEffectsDefinition.beforeSuccess(this.allStdout, this.allStderr));
                    }

                    result = beforeFinishing.then(() => {
                        this.process.emit("exit", code);
                    });
                    break;
                case "custom":
                    return (<ICustomEvent>event).custom.lambda();
                default:
                    throw new Error(`Unknown event to simulate: ${key} from:\n\t${event}`);
            }
            return Q.resolve<void>(void 0);
        });
    }
}
