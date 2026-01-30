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
import winston from "winston";
import nodeInfoCodec from "../../sockets/nodeInfoCodec.js";
import nodePeersCodec from "../../sockets/nodePeersCodec.js";
import chainInfoCodec from "../../sockets/chainInfoCodec.js";
import fs from "fs";
import path from "path";

const packetHeader = catapult.packet.header;
const { PacketType } = catapult.packet;
const { BinaryParser } = catapult.parser;

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

        const pingPromises = hosts.map(async (host) => {
          try {
            const pingBuf = packetHeader.createBuffer(
              PacketType.nodeDiscoveryPullPing,
              packetHeader.size
            );
            const chainBuf = packetHeader.createBuffer(
              PacketType.chainStatistics,
              packetHeader.size
            );

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
            const peerConnections = createConnectionService(peerConfig, winston.verbose);

            const conn1 = await peerConnections.singleUse();
            const pingPkt = await conn1.pushPull(pingBuf, timeout);
            const nodeInfo = buildResponse(pingPkt, nodeInfoCodec, routeResultTypes.nodeInfo).payload;

            const conn2 = await peerConnections.singleUse();
            const chainPkt = await conn2.pushPull(chainBuf, timeout);
            const chainInfo = buildResponse(chainPkt, chainInfoCodec, routeResultTypes.chainInfo).payload;

            return { ...nodeInfo, ...chainInfo };
          } catch (error) {
            return null;
          }
        });
        const nodeInfos = (await Promise.all(pingPromises)).filter(info => info !== null);

        const finalizedBlockInfo = await db.latestFinalizedBlock();

        const formattedPayload = nodeInfos.map(info => {
          const formatted = {};
          Object.keys(info).forEach(key => {
            const value = info[key];
            if (typeof value === 'bigint') {
              formatted[key] = value.toString();
            } else if (Buffer.isBuffer(value)) {
              if (key === 'host' || key === 'friendlyName') {
                formatted[key] = value.toString('utf8');
              } else {
                formatted[key] = value.toString('hex').toUpperCase();
              }
            } else {
              formatted[key] = value;
            }
          });
          if (finalizedBlockInfo?.block) {
            formatted.latestFinalizedBlock = {
              height: finalizedBlockInfo.block.height?.toString(),
              finalizationEpoch: finalizedBlockInfo.block.finalizationEpoch,
              finalizationPoint: finalizedBlockInfo.block.finalizationPoint
            };
          }
          return formatted;
        });

        res.send(formattedPayload);
        next();
      } catch (err) {
        next(err);
      }
    });
  },
};
