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

import mijinStatusRoutes from '../../../src/plugins/mijin/mijinStatusRoutes.js';
import test from '../../routes/utils/routeTestUtils.js';
import { Address } from '@tech-bureau/symbol-sdk/symbol';
import { expect } from 'chai';
import MongoDb from 'mongodb';
import tmp from 'tmp';
import fs from 'fs';

const { Long } = MongoDb;

describe('mijin status routes', () => {
	// 160 blocks of 15s: 40 minutes per epoch, 36 epochs per day
	const networkFile = tmp.fileSync();
	fs.writeFileSync(networkFile.name, [
		'[chain]',
		'harvestingMosaicId = 0x0123\'4567\'89AB\'CDEF',
		'minVoterBalance = 1\'000\'000',
		'votingSetGrouping = 160',
		'blockGenerationTargetTime = 15s'
	].join('\n'));

	const createNodeFile = batchSize => {
		const nodeFile = tmp.fileSync();
		fs.writeFileSync(nodeFile.name, ['[node]', `fileDatabaseBatchSize = ${batchSize}`].join('\n'));
		return nodeFile.name;
	};

	const harvestingMosaicId = Long.fromBigInt(0x0123456789ABCDEFn);
	const otherMosaicId = Long.fromBigInt(0xFEDCBA9876543210n, true);

	const uint64Bytes = value => {
		const buffer = Buffer.alloc(8);
		buffer.writeBigUInt64LE(BigInt(value));
		return buffer;
	};

	const packetType = buffer => buffer.readUInt32LE(4);

	const executeRoute = (routeName, db, services) => new Promise(resolve => {
		test.route.prepareExecuteRoute(mijinStatusRoutes.register, routeName, 'get', {}, db, services, routeContext =>
			routeContext.routeInvoker().then(() => {
				expect(routeContext.responses.length).to.equal(1);
				resolve(routeContext.responses[0]);
			}));
	});

	describe('voting keys', () => {
		const address = 'MC2CYKRYRVGH54STGJYGDK4UIRINKK5OUM2OIWQ';

		const createAccount = (balance, endEpochs, mosaicId = harvestingMosaicId) => ({
			account: {
				address: Buffer.from(new Address(address).bytes),
				mosaics: [{ id: mosaicId, amount: Long.fromBigInt(BigInt(balance)) }],
				supplementalPublicKeys: {
					voting: {
						publicKeys: endEpochs.map((endEpoch, i) => ({
							publicKey: Buffer.alloc(32, i + 1),
							startEpoch: 1,
							endEpoch
						}))
					}
				}
			}
		});

		const services = { config: { apiNode: { timeout: 1000, networkPropertyFilePath: networkFile.name } } };

		const createDb = (accounts, finalizationEpoch) => ({
			latestFinalizedBlock: () => Promise.resolve(undefined === finalizationEpoch ? undefined : { block: { finalizationEpoch } }),
			queryDocuments: (collectionName, conditions) => {
				expect(collectionName).to.equal('accounts');
				expect(conditions).to.deep.equal({ 'account.supplementalPublicKeys.voting': { $exists: true } });
				return Promise.resolve(accounts);
			}
		});

		it('returns the voting accounts, the ones that can vote and expire first at the top', async () => {
			// Arrange:
			const db = createDb([
				createAccount(1_000_000, [10 + 360]), // can vote, 10 days left
				createAccount(999_999, [100]), // balance below minVoterBalance
				createAccount(5_000_000, [20, 10 + 36]), // can vote, 1 day left with the last key
				createAccount(1_000_000, [5]), // can vote, expired
				createAccount(9_000_000, [7], otherMosaicId) // no harvesting mosaic
			], 10);

			// Act:
			const response = await executeRoute('/mijin/votingkeys', db, services);

			// Assert:
			expect({ ...response, votingAccounts: undefined }).to.deep.equal({
				currentEpoch: 10,
				votingSetGrouping: 160,
				blockGenerationTargetTime: '15s',
				minVoterBalance: '1000000',
				votingAccounts: undefined
			});
			expect(response.votingAccounts.map(account => [
				account.balance, account.eligible, account.endEpoch, account.remainingEpochs, account.remainingDays, account.expired
			])).to.deep.equal([
				['1000000', true, 5, -5, -1, true],
				['5000000', true, 46, 36, 1, false],
				['1000000', true, 370, 360, 10, false],
				['0', false, 7, -3, -1, true],
				['999999', false, 100, 90, 2, false]
			]);
			expect(response.votingAccounts[0].address).to.equal(address);
			expect(response.votingAccounts[1].keys).to.deep.equal([
				{ publicKey: '01'.repeat(32), startEpoch: 1, endEpoch: 20 },
				{ publicKey: '02'.repeat(32), startEpoch: 1, endEpoch: 46 }
			]);
		});

		it('counts from the first epoch when nothing is finalized', async () => {
			// Act:
			const response = await executeRoute('/mijin/votingkeys', createDb([createAccount(1_000_000, [37])]), services);

			// Assert:
			expect(response.currentEpoch).to.equal(1);
			expect(response.votingAccounts[0].remainingEpochs).to.equal(36);
			expect(response.votingAccounts[0].remainingDays).to.equal(1);
		});
	});

	describe('storage', () => {
		const encodeCounterName = name => [...name].reduce(
			(value, ch) => (value * 27n) + (' ' === ch ? 0n : BigInt(ch.charCodeAt(0) - 'A'.charCodeAt(0) + 1)),
			0n
		);

		const createPackets = (height, finalizedHeight, counters) => ({
			5: {
				payload: Buffer.concat([uint64Bytes(height), uint64Bytes(finalizedHeight), uint64Bytes(0), uint64Bytes(1)])
			},
			0x132: {
				payload: Buffer.concat([
					Buffer.from([0x11, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]), // epoch, point
					uint64Bytes(finalizedHeight),
					Buffer.alloc(32)
				])
			},
			0x300: counters && {
				payload: Buffer.concat(Object.entries(counters).map(([name, value]) =>
					Buffer.concat([uint64Bytes(encodeCounterName(name)), uint64Bytes(value)])))
			}
		});

		const nodeFileWithBatchSize1 = createNodeFile(1);

		const createServices = (packets, isReachable = true, nodePropertyFilePath = nodeFileWithBatchSize1) => ({
			connections: {
				singleUse: () => (isReachable
					? Promise.resolve({
						pushPull: buffer => {
							const packet = packets[packetType(buffer)];
							return packet ? Promise.resolve(packet) : Promise.reject(Error('socket closed'));
						}
					})
					: Promise.reject(Error('connection refused')))
			},
			config: { apiNode: { timeout: 1000, networkPropertyFilePath: networkFile.name, nodePropertyFilePath } }
		});

		const databaseCounts = {
			accounts: 18,
			mosaics: 4,
			namespaces: 5,
			transactions: 50,
			secretLocks: 0,
			hashLocks: 0,
			multisigs: 0,
			metadata: 0,
			accountRestrictions: 0,
			mosaicRestrictions: 0
		};

		const nodeCounters = {
			'ACNTST C': 18,
			'MOSAIC C': 4,
			'NS C': 3,
			'NS C DS': 5,
			'TOT CONF TXES': 50,
			'SECRETLOCK C': 0,
			'HASHLOCK C': 0,
			'MULTISIG C': 0,
			'METADATA C': 0,
			'ACCTREST C': 0,
			'MOSAICREST C': 0,
			'MEM CUR RSS': 122
		};

		// blocks without transactions: 736 bytes in the .dat file, 8 KB on disk with the .stmt file
		const emptyBlocks = function* (fromHeight, toHeight) {
			for (let height = fromHeight; height <= toHeight; ++height)
				yield { height: Long.fromNumber(height), size: 376, transactionsCount: 0, subCacheMerkleRootsCount: 9 };
		};

		const databaseStats = {
			dataSize: 4602426,
			totalSize: 5760 * 1000, // 1000 bytes per block at height 5760 (one day)
			fsUsedSize: 2_000_000_000,
			fsTotalSize: 10_000_000_000
		};

		const createDb = (height, finalizedHeight, counts, stats = databaseStats) => ({
			chainStatisticCurrent: () => Promise.resolve({ height: Long.fromNumber(height) }),
			latestFinalizedBlock: () => Promise.resolve({ block: { height: Long.fromNumber(finalizedHeight), finalizationEpoch: 17 } }),
			database: {
				stats: () => Promise.resolve(stats),
				collection: name => ({
					countDocuments: () => Promise.resolve(counts[name]),
					aggregate: pipeline => {
						const range = pipeline[0].$match['block.height'];
						return emptyBlocks(range.$gt.toNumber() + 1, range.$lte.toNumber());
					}
				})
			}
		});

		it('compares the node with the database', async () => {
			// Act:
			const response = await executeRoute(
				'/mijin/storage',
				createDb(2566, 2552, databaseCounts),
				createServices(createPackets(2568, 2552, nodeCounters))
			);

			// Assert:
			expect(response.node.height).to.equal('2568');
			expect(response.node.finalizedHeight).to.equal('2552');
			expect(response.node.counters['NS C DS']).to.equal('5');
			expect(response.node.counters['MEM CUR RSS']).to.equal('122');
			expect({ ...response.database, disk: undefined }).to.deep.equal({
				height: '2566', finalizedHeight: '2552', counts: databaseCounts, disk: undefined
			});
			expect(response.behind).to.deep.equal({ height: 2, finalizedHeight: 0 });
			expect(response.nodeError).to.equal(undefined);
			expect(response.comparisons.map(comparison => comparison.name)).to.deep.equal([
				'accounts', 'mosaics', 'namespaces', 'transactions', 'secretLocks', 'hashLocks', 'multisigs', 'metadata',
				'accountRestrictions', 'mosaicRestrictions'
			]);
			expect(response.comparisons.every(comparison => comparison.match)).to.equal(true);
		});

		it('reports a database that holds a different number of entries', async () => {
			// Act: every namespace stored twice
			const response = await executeRoute(
				'/mijin/storage',
				createDb(2568, 2552, { ...databaseCounts, namespaces: 10 }),
				createServices(createPackets(2568, 2552, nodeCounters))
			);

			// Assert:
			expect(response.comparisons.filter(comparison => !comparison.match)).to.deep.equal([
				{ name: 'namespaces', node: 5, database: 10, match: false }
			]);
		});

		it('returns the heights when the node does not give its counters', async () => {
			// Act:
			const response = await executeRoute(
				'/mijin/storage',
				createDb(2568, 2552, databaseCounts),
				createServices(createPackets(2570, 2552, undefined))
			);

			// Assert:
			expect(response.node).to.deep.equal({ height: '2570', finalizedHeight: '2552' });
			expect(response.behind).to.deep.equal({ height: 2, finalizedHeight: 0 });
			expect(response.nodeError).to.contain('diagnostic counters');
			expect(response.comparisons).to.deep.equal([]);
		});

		it('returns the database when the node cannot be reached', async () => {
			// Act:
			const response = await executeRoute(
				'/mijin/storage',
				createDb(2568, 2552, databaseCounts),
				createServices({}, false)
			);

			// Assert:
			expect(response.node).to.equal(null);
			expect(response.behind).to.equal(null);
			expect(response.nodeError).to.contain('chain statistics');
			expect(response.database.height).to.equal('2568');
			expect(response.comparisons).to.deep.equal([]);
		});

		it('estimates the block files on disk and their growth', async () => {
			// Act:
			const response = await executeRoute(
				'/mijin/storage',
				createDb(2566, 2552, databaseCounts),
				createServices(createPackets(2566, 2552, nodeCounters))
			);

			// Assert: 8 KB per block, hashes.dat (32 bytes per block) and one .proof file per finalized epoch
			expect(response.blockFiles).to.deep.equal({
				estimated: true,
				readHeight: 2552,
				complete: true,
				blockFileBytes: 2552 * 736,
				diskBytes: (2566 * 8192) + (21 * 4096) + (17 * 4096),
				growthPerDayBytes: 5760 * 8192,
				fileSystemBlockSize: 4096
			});
		});

		it('does not estimate the block files of a node that groups blocks in files', async () => {
			// Act:
			const response = await executeRoute(
				'/mijin/storage',
				createDb(2566, 2552, databaseCounts),
				createServices(createPackets(2566, 2552, nodeCounters), true, createNodeFile(100))
			);

			// Assert:
			expect(response.blockFiles).to.deep.equal({
				estimated: false,
				reason: 'only estimated with fileDatabaseBatchSize = 1, not 100'
			});
		});

		it('gives the disk use of the database, its growth and the free space of its file system', async () => {
			// Act:
			const response = await executeRoute(
				'/mijin/storage',
				createDb(5760, 5744, databaseCounts),
				createServices(createPackets(5760, 5744, nodeCounters))
			);

			// Assert: 1000 bytes per block, 5760 blocks a day
			expect({ ...response.database.disk, note: undefined }).to.deep.equal({
				dataBytes: 4602426,
				diskBytes: 5760000,
				growthPerDayBytes: 5760000,
				fileSystem: {
					totalBytes: 10_000_000_000,
					usedBytes: 2_000_000_000,
					freeBytes: 8_000_000_000,
					daysUntilFull: 1388
				},
				note: undefined
			});
			expect(response.database.disk.note).to.contain('journal');
		});

		it('gives the disk use of the database without file system sizes when mongo does not give them', async () => {
			// Act:
			const response = await executeRoute(
				'/mijin/storage',
				createDb(5760, 5744, databaseCounts, { dataSize: 10, totalSize: Long.fromNumber(5760) }),
				createServices(createPackets(5760, 5744, nodeCounters))
			);

			// Assert:
			expect(response.database.disk.diskBytes).to.equal(5760);
			expect(response.database.disk.growthPerDayBytes).to.equal(5760);
			expect(response.database.disk.fileSystem).to.equal(undefined);
		});
	});
});
