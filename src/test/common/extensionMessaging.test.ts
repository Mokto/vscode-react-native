// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import {HostPlatform} from "../../common/hostPlatform";

import {
    ExtensionMessage,
    ExtensionMessageSender,
} from "../../common/extensionMessaging";

import * as assert from "assert";
import * as net from "net";
import * as Q from "q";

let mockServer: net.Server;

suite("extensionMessaging", function() {
    suite("commonContext", function() {
        teardown(function() {
            if (mockServer) {
                mockServer.close();
            }
        });

        test("should successfully send a message", function(done: MochaDone) {
            const port: string = HostPlatform.getExtensionPipePath();
            let receivedMessage: ExtensionMessage;

            mockServer = net.createServer(function(client: net.Socket): void {
                mockServer.close();
                client.on("data", function(data: Buffer) {
                    const messageData: any = JSON.parse(data.toString("utf8"));
                    client.end();

                    receivedMessage = messageData.message;
                });
            });

            mockServer.on("error", done);
            mockServer.listen(port);

            const sender = new ExtensionMessageSender();

            Q({})
                .then(function() {
                    return sender.sendMessage(ExtensionMessage.START_PACKAGER);
                })
                .then(function() {
                    assert.equal(receivedMessage, ExtensionMessage.START_PACKAGER);
                }).done(() => done(), done);
        });

        test("should successfully send a message with args", function(done: MochaDone) {
            const port: string = HostPlatform.getExtensionPipePath();
            const args = ["android"];
            let receivedMessage: ExtensionMessage;
            let receivedArgs: any;

            mockServer = net.createServer(function(client: net.Socket): void {
                mockServer.close();
                client.on("data", function(data: Buffer) {
                    const messageData: any = JSON.parse(data.toString("utf8"));
                    client.end();

                    receivedMessage = messageData.message;
                    receivedArgs = messageData.args;
                });
            });

            mockServer.on("error", done);
            mockServer.listen(port);

            const sender = new ExtensionMessageSender();

            Q({})
                .then(function() {
                    return sender.sendMessage(ExtensionMessage.PREWARM_BUNDLE_CACHE, args);
                })
                .then(function() {
                    assert.equal(receivedMessage, ExtensionMessage.PREWARM_BUNDLE_CACHE);
                    assert.deepEqual(receivedArgs, args);
                }).done(() => done(), done);
        });

        test("should reject on socket error", function(done: MochaDone) {
            const sender = new ExtensionMessageSender();

            Q({})
                .then(function() {
                    return sender.sendMessage(ExtensionMessage.PREWARM_BUNDLE_CACHE);
                })
                .then(function() {
                    assert(false, "sendMessage should reject on socket error");
                },
                function(reason: any) {
                    let expectedErrorMessage = "An error ocurred while handling message: PREWARM_BUNDLE_CACHE";
                    assert.equal(reason.message, expectedErrorMessage);
                })
                .done(() => done(), done);
        });
    });
});