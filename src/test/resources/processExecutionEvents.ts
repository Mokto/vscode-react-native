// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

/* Event types used by the ProcessExecutionRecorder and ProcessExecutionSimulator */

export interface ITimedEvent {
    after: number;
}

export interface IStdOutEvent extends ITimedEvent {
    stdout: { data: string };
}

export interface IStdErrEvent extends ITimedEvent {
    stderr: { data: string };
}

export interface IErrorEvent extends ITimedEvent {
    error: { error: any };
}

export interface IExitEvent extends ITimedEvent {
    exit: { code: number };
}

export interface ICustomEvent extends ITimedEvent {
    custom: { lambda: () => Q.Promise<void> | void };
}

export type IEventArguments = IStdOutEvent | IStdErrEvent | IErrorEvent | IExitEvent | ICustomEvent;

export interface MachineConfiguration {
    os: { platform: string, release: string };
    android: {
        sdk: { tools: string, platformTools: string, buildTools: string, repositoryForSupportLibraries: string };
        intelHAXMEmulator: string;
        visualStudioEmulator: string;
    };
    reactNative: string;
    node: string;
    npm: string;
}

export type PackagerStatus = "Running" | "NotRunning" | "TBD";

export type AndroidDeviceType = "SDKEmulator" | "VisualStudioEmulator" | "IntelHAXMEmulator_x86" | "IntelHAXMEmulator_x64" | "PhysicalDevice";

export type AppStatusInDevice = "NotInstalled" | "Installed" | "Running" | "Debugging" | "TBD";

export type IIOSDeviceType = "TBD";

export interface IAndroidDevice {
    id: string;
    type: AndroidDeviceType;
    hardware: string;
    os: string;
    api: number;
    otherSpecs: string;
    appStatus: AppStatusInDevice;
}

export interface IIOSDevice {
    id: string;
    type: IIOSDeviceType;
    appStatus: AppStatusInDevice;
}

export interface MachineState {
    reactNative: { packager: PackagerStatus };
    devices: { android: IAndroidDevice[], ios: IIOSDevice[] };
}

interface ISpawnOptions {
    cwd?: string;
    stdio?: any;
    env?: any;
    detached?: boolean;
}

export interface ISpawnArguments {
    command: string;
    args: string[];
    options: ISpawnOptions;
}

export interface ProcessExecutionRecording {
    title: string;
    arguments: ISpawnArguments;
    date: Date;
    configuration: MachineConfiguration;
    state: MachineState;
    events: IEventArguments[];
}
