/*
 * Copyright (c) 2016-2019, Jaguar0625, gimre, BloodyRookie, Tech Bureau, Corp.
 * Copyright (c) 2020-present, Jaguar0625, gimre, BloodyRookie.
 * All rights reserved.
 *
 * This file is part of Catapult.
 *
 * Catapult is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Catapult is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Catapult.  If not, see <http://www.gnu.org/licenses/>.
 */

import createConnectionService from "./connection/connectionService.js";
import routeResultTypes from "../../routes/routeResultTypes.js";
import catapult from "../../catapult-sdk/index.js";
import routeUtils from "../../routes/routeUtils.js";
import { utils } from "@tech-bureau/symbol-sdk";
import winston from "winston";
import nodeInfoCodec from "../../sockets/nodeInfoCodec.js";
import nodePeersCodec from "../../sockets/nodePeersCodec.js";
import fs from "fs";
import path from "path";

const packetHeader = catapult.packet.header;
const { PacketType } = catapult.packet;
const { BinaryParser } = catapult.parser;

const restVersion = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../package.json"),
    "UTF-8"
  )
).version;

const buildResponse = (packet, codec, resultType) => {
  const binaryParser = new BinaryParser();
  binaryParser.push(packet.payload);
  return {
    payload: codec.deserialize(binaryParser),
    type: resultType,
    formatter: "ws",
  };
};

export default {
  register: (server, db, services) => {
    const { connections } = services;
    const { timeout } = services.config.apiNode;

    server.get("/mijin/peersinfo", async (req, res, next) => {
      try {
        const packetBuffer = packetHeader.createBuffer(
          PacketType.nodeDiscoveryPullPeers,
          packetHeader.size
        );
        const conn0 = await connections.singleUse();
        const packet0 = await conn0.pushPull(packetBuffer, timeout);
        const peersInfo = buildResponse(
          packet0,
          nodePeersCodec,
          routeResultTypes.nodeInfo
        ).payload;

        const hosts = peersInfo.map((p) => p.host.toString());
        hosts.push(services.config.apiNode.host);

        const pingPromises = hosts.map((host) => {
          const peerConfig = {
            apiNode: {
              host: host,
              port: services.config.apiNode.port,
              key: fs.readFileSync(services.config.apiNode.tlsClientKeyPath),
              certificate: fs.readFileSync(
                services.config.apiNode.tlsClientCertificatePath
              ),
              caCertificate: fs.readFileSync(
                services.config.apiNode.tlsCaCertificatePath
              ),
            },
          };

          const peerConnections = createConnectionService(
            peerConfig,
            winston.verbose
          );

          const buf = packetHeader.createBuffer(
            PacketType.nodeDiscoveryPullPing,
            packetHeader.size
          );

          return peerConnections
            .singleUse()
            .then((conn) => conn.pushPull(buf, timeout))
            .then((pingPkt) =>
              buildResponse(pingPkt, nodeInfoCodec, routeResultTypes.nodeInfo)
            );
        });
        const pingResults = await Promise.all(pingPromises);

        res.send({
          payload: pingResults.map((p) => p.payload),
          type: pingResults[0].type,
          formatter: pingResults[0].formatter,
        });
        next();
      } catch (err) {
        next(err);
      }
    });
  },
};
