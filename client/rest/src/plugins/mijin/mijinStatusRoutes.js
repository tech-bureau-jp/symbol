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

import {
	File_System_Block_Size, createBlockFilesEstimator, diskSize, toNumber
} from './blockFilesEstimator.js';
import catapult from '../../catapult-sdk/index.js';
import { longToUint64 } from '../../db/dbUtils.js';
import chainInfoCodec from '../../sockets/chainInfoCodec.js';
import finalizedBlockCodec from '../../sockets/finalizedBlockCodec.js';
import { Address } from '@tech-bureau/symbol-sdk/symbol';
import ini from 'ini';

const packetHeader = catapult.packet.header;
const { PacketType } = catapult.packet;
const { BinaryParser } = catapult.parser;

const fileLoader = new catapult.utils.CachedFileLoader();

const Diagnostic_Counters_Packet_Type = 0x300;
const Counter_Name_Alphabet_Size = 27n;
const Seconds_Per_Day = 24 * 60 * 60;
const Days_Per_Year = 365;

// a request waits for the block files estimate only when it has at most this many new blocks to read
const Max_Blocks_Read_In_Request = 10000;

/**
 * Counters of the node caches, with the mongo collection that holds the same entries.
 * Only counters whose size matches one document per entry are compared.
 */
const cacheCounters = [
	{ counter: 'ACNTST C', collection: 'accounts' },
	{ counter: 'MOSAIC C', collection: 'mosaics' },
	{ counter: 'NS C DS', collection: 'namespaces' }, // every namespace, with the history of its root
	{ counter: 'TOT CONF TXES', collection: 'transactions' }, // includes the transactions inside aggregates
	{ counter: 'SECRETLOCK C', collection: 'secretLocks' },
	{ counter: 'HASHLOCK C', collection: 'hashLocks' },
	{ counter: 'MULTISIG C', collection: 'multisigs' },
	{ counter: 'METADATA C', collection: 'metadata' },
	{ counter: 'ACCTREST C', collection: 'accountRestrictions' },
	{ counter: 'MOSAICREST C', collection: 'mosaicRestrictions' }
];

const toInteger = value => BigInt(String(value).replace(/'/g, ''));

/**
 * Converts a catapult time span (e.g. 15s, 2m, 1h, 500ms) to seconds.
 * @param {string} value Time span.
 * @returns {number} Seconds.
 */
const timeSpanToSeconds = value => {
	const match = /^(\d+)(ms|s|m|h)$/.exec(String(value).replace(/'/g, '').trim());
	if (!match)
		throw Error(`unsupported time span: ${value}`);

	const multipliers = { ms: 0.001, s: 1, m: 60, h: 60 * 60 };
	return Number(match[1]) * multipliers[match[2]];
};

/**
 * Decodes a diagnostic counter id into its name (' ' and A-Z in base 27).
 * @param {bigint} id Counter id.
 * @returns {string} Counter name.
 */
const decodeCounterName = id => {
	let name = '';
	let value = id;
	while (0n < value) {
		const ch = value % Counter_Name_Alphabet_Size;
		name = (0n === ch ? ' ' : String.fromCharCode(Number(ch) - 1 + 'A'.charCodeAt(0))) + name;
		value /= Counter_Name_Alphabet_Size;
	}

	return name;
};

const diagnosticCountersCodec = {
	deserialize: parser => {
		const counters = {};
		while (0 < parser.numUnprocessedBytes()) {
			const id = parser.uint64();
			counters[decodeCounterName(id)] = parser.uint64();
		}

		return counters;
	}
};

// mongo Binary or bytes
const toBuffer = binary => Buffer.from(binary instanceof Uint8Array ? binary : binary.buffer);

export default {
	register: (server, db, services) => {
		const { connections } = services;
		const { timeout } = services.config.apiNode;

		const readAndParseNetworkPropertiesFile = () => fileLoader.readOnce(
			services.config.apiNode.networkPropertyFilePath,
			contents => ini.parse(contents)
		);

		const readAndParseNodePropertiesFile = () => fileLoader.readOnce(
			services.config.apiNode.nodePropertyFilePath,
			contents => ini.parse(contents)
		);

		// created on the first request, when the block time is known
		let blockFilesEstimator = null;

		const estimateBlockFiles = async (databaseHeight, finalizedHeight, finalizationEpoch) => {
			const { node } = await readAndParseNodePropertiesFile();
			const batchSize = Number(toInteger(node.fileDatabaseBatchSize));
			if (1 !== batchSize)
				return { estimated: false, reason: `only estimated with fileDatabaseBatchSize = 1, not ${batchSize}` };

			const blocksPerDay = await readBlocksPerDay();
			if (!blockFilesEstimator)
				blockFilesEstimator = createBlockFilesEstimator(db, Math.round(blocksPerDay));

			// finalized blocks do not change; a large first read goes on in the background
			const update = blockFilesEstimator.update(finalizedHeight);
			if (Max_Blocks_Read_In_Request >= finalizedHeight - blockFilesEstimator.snapshot().height)
				await update;

			const read = blockFilesEstimator.snapshot();
			const averageDiskBytes = 0 === read.height ? 2 * File_System_Block_Size : read.averageDiskBytes;
			const recentAverageDiskBytes = 0 === read.height ? averageDiskBytes : read.recentAverageDiskBytes;
			const otherDiskBytes = diskSize(32 * databaseHeight) // hashes.dat
				+ (finalizationEpoch * File_System_Block_Size); // one .proof file per finalized epoch

			return {
				estimated: true,
				readHeight: read.height,
				complete: read.height >= finalizedHeight,
				blockFileBytes: read.fileBytes,
				diskBytes: Math.round(read.diskBytes + ((databaseHeight - read.height) * averageDiskBytes) + otherDiskBytes),
				growthPerDayBytes: Math.round(recentAverageDiskBytes * blocksPerDay),
				growthPerYearBytes: Math.round(recentAverageDiskBytes * blocksPerDay) * Days_Per_Year,
				fileSystemBlockSize: File_System_Block_Size
			};
		};

		const readBlocksPerDay = async () => {
			const { chain } = await readAndParseNetworkPropertiesFile();
			return Seconds_Per_Day / timeSpanToSeconds(chain.blockGenerationTargetTime);
		};

		// sizes from the database metadata, so this does not depend on the number of blocks
		const estimateDatabaseDisk = async databaseHeight => {
			const stats = await db.database.stats();
			const diskBytes = toNumber(stats.totalSize);
			const growthPerDayBytes = 0 === databaseHeight ? 0 : Math.round((diskBytes / databaseHeight) * await readBlocksPerDay());

			const disk = {
				dataBytes: toNumber(stats.dataSize),
				diskBytes,
				growthPerDayBytes,
				growthPerYearBytes: growthPerDayBytes * Days_Per_Year
			};

			// the file system that holds the database files (the mongo volume)
			if (undefined !== stats.fsTotalSize) {
				const totalBytes = toNumber(stats.fsTotalSize);
				const usedBytes = toNumber(stats.fsUsedSize);
				disk.fileSystem = {
					totalBytes,
					usedBytes,
					freeBytes: totalBytes - usedBytes,
					daysUntilFull: 0 === growthPerDayBytes ? null : Math.floor((totalBytes - usedBytes) / growthPerDayBytes)
				};
			}

			disk.note = 'mongo also keeps its journal (about 200 MB) and diagnostic data (up to 200 MB) on the same file system';
			return disk;
		};

		const fetchAndParse = async (packetType, codec) => {
			const connection = await connections.singleUse();
			const packet = await connection.pushPull(packetHeader.createBuffer(packetType, packetHeader.size), timeout);

			const parser = new BinaryParser();
			parser.push(packet.payload);
			return codec.deserialize(parser);
		};

		server.get('/mijin/votingkeys', async (request, reply) => {
			const { chain } = await readAndParseNetworkPropertiesFile();
			const harvestingMosaicId = toInteger(chain.harvestingMosaicId);
			const minVoterBalance = toInteger(chain.minVoterBalance);
			const votingSetGrouping = Number(toInteger(chain.votingSetGrouping));
			const secondsPerEpoch = votingSetGrouping * timeSpanToSeconds(chain.blockGenerationTargetTime);

			const finalizedBlock = await db.latestFinalizedBlock();
			const currentEpoch = finalizedBlock ? finalizedBlock.block.finalizationEpoch : 1;

			const accounts = await db.queryDocuments('accounts', { 'account.supplementalPublicKeys.voting': { $exists: true } });
			const votingAccounts = accounts.map(({ account }) => {
				const harvestingMosaic = (account.mosaics || []).find(mosaic => harvestingMosaicId === longToUint64(mosaic.id));
				const balance = harvestingMosaic ? longToUint64(harvestingMosaic.amount) : 0n;

				const keys = account.supplementalPublicKeys.voting.publicKeys.map(key => ({
					publicKey: toBuffer(key.publicKey).toString('hex').toUpperCase(),
					startEpoch: key.startEpoch,
					endEpoch: key.endEpoch
				}));
				const endEpoch = Math.max(...keys.map(key => key.endEpoch));
				const remainingEpochs = endEpoch - currentEpoch;

				return {
					address: new Address(toBuffer(account.address)).toString(),
					balance: balance.toString(),
					eligible: balance >= minVoterBalance,
					endEpoch,
					remainingEpochs,
					remainingDays: Math.floor((remainingEpochs * secondsPerEpoch) / Seconds_Per_Day),
					expired: 0 > remainingEpochs,
					keys
				};
			});

			// accounts that can vote first, then the ones whose keys expire first
			votingAccounts.sort((lhs, rhs) => (Number(rhs.eligible) - Number(lhs.eligible)) || (lhs.endEpoch - rhs.endEpoch));

			return reply.send({
				currentEpoch,
				votingSetGrouping,
				blockGenerationTargetTime: chain.blockGenerationTargetTime,
				minVoterBalance: minVoterBalance.toString(),
				votingAccounts
			});
		});

		server.get('/mijin/storage', async (request, reply) => {
			const chainStatistic = await db.chainStatisticCurrent();
			const finalizedBlock = await db.latestFinalizedBlock();
			const database = {
				height: longToUint64(chainStatistic.height).toString(),
				finalizedHeight: finalizedBlock ? longToUint64(finalizedBlock.block.height).toString() : '0',
				counts: {}
			};

			await Promise.all(cacheCounters.map(async ({ collection }) => {
				database.counts[collection] = await db.database.collection(collection).countDocuments();
			}));
			database.disk = await estimateDatabaseDisk(Number(database.height));

			let node = null;
			let nodeError;
			try {
				const chainInfo = await fetchAndParse(PacketType.chainStatistics, chainInfoCodec);
				const nodeFinalizedBlock = await fetchAndParse(PacketType.finalizationStatistics, finalizedBlockCodec);
				node = {
					height: chainInfo.height.toString(),
					finalizedHeight: nodeFinalizedBlock.height.toString()
				};
			} catch (error) {
				nodeError = `cannot get the chain statistics of the node: ${error.message || error}`;
			}

			// the node answers only to its trusted hosts, so it may refuse
			let counters = null;
			if (node) {
				try {
					counters = await fetchAndParse(Diagnostic_Counters_Packet_Type, diagnosticCountersCodec);
				} catch (error) {
					nodeError = `cannot get the diagnostic counters of the node: ${error.message || error}`;
				}
			}

			const comparisons = [];
			if (counters) {
				node.counters = Object.fromEntries(Object.entries(counters).map(([name, value]) => [name, value.toString()]));

				cacheCounters.forEach(({ counter, collection }) => {
					if (undefined === counters[counter])
						return;

					const nodeCount = Number(counters[counter]);
					const databaseCount = database.counts[collection];
					comparisons.push({ name: collection, node: nodeCount, database: databaseCount, match: nodeCount === databaseCount });
				});
			}

			const behind = node
				? {
					height: Number(BigInt(node.height) - BigInt(database.height)),
					finalizedHeight: Number(BigInt(node.finalizedHeight) - BigInt(database.finalizedHeight))
				}
				: null;

			const blockFiles = await estimateBlockFiles(
				Number(database.height),
				Number(database.finalizedHeight),
				finalizedBlock ? finalizedBlock.block.finalizationEpoch : 0
			);

			return reply.send({
				node,
				...(nodeError ? { nodeError } : {}),
				database,
				behind,
				comparisons,
				blockFiles
			});
		});
	}
};
