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
	blockDiskSize, blockFileSize, createBlockFilesEstimator, diskSize
} from '../../../src/plugins/mijin/blockFilesEstimator.js';
import { expect } from 'chai';
import MongoDb from 'mongodb';

const { Long, Int32 } = MongoDb;

describe('block files estimator', () => {
	describe('sizes', () => {
		it('gives the size of the .dat file of a block', () => {
			// Assert: sizes of the files written by a node (heights 2 and 86 of a test network)
			expect(blockFileSize({ size: 376, transactionsCount: 0, subCacheMerkleRootsCount: 9 })).to.equal(736);
			expect(blockFileSize({ size: 784, transactionsCount: 1, subCacheMerkleRootsCount: 9 })).to.equal(1208);
		});

		it('rounds file sizes up to file system blocks', () => {
			expect(diskSize(0)).to.equal(0);
			expect(diskSize(1)).to.equal(4096);
			expect(diskSize(4096)).to.equal(4096);
			expect(diskSize(4097)).to.equal(8192);
		});

		it('counts the .dat file and one file system block for the .stmt file', () => {
			expect(blockDiskSize({ size: 376, transactionsCount: 0, subCacheMerkleRootsCount: 9 })).to.equal(8192);
			expect(blockDiskSize({ size: 8000, transactionsCount: 10, subCacheMerkleRootsCount: 9 })).to.equal(12288 + 4096);
		});
	});

	describe('estimator', () => {
		const createDb = blocksBySize => {
			const ranges = [];
			const db = {
				database: {
					collection: name => ({
						aggregate: pipeline => {
							expect(name).to.equal('blocks');
							const range = pipeline[0].$match['block.height'];
							const fromHeight = range.$gt.toNumber() + 1;
							const toHeight = range.$lte.toNumber();
							ranges.push([fromHeight, toHeight]);

							const blocks = [];
							for (let height = fromHeight; height <= toHeight; ++height) {
								blocks.push({
									height: Long.fromNumber(height),
									size: new Int32(blocksBySize(height)),
									transactionsCount: 0,
									subCacheMerkleRootsCount: 9
								});
							}

							return blocks;
						}
					})
				}
			};
			return { db, ranges };
		};

		it('reads only the blocks above the last height read', async () => {
			// Arrange:
			const { db, ranges } = createDb(() => 376);
			const estimator = createBlockFilesEstimator(db, 100);

			// Act:
			await estimator.update(10);
			await estimator.update(10);
			await estimator.update(15);

			// Assert:
			expect(ranges).to.deep.equal([[1, 10], [11, 15]]);
			expect(estimator.snapshot()).to.deep.equal({
				height: 15,
				fileBytes: 15 * 736,
				diskBytes: 15 * 8192,
				averageDiskBytes: 8192,
				recentAverageDiskBytes: 8192
			});
		});

		it('runs one read at a time', async () => {
			// Arrange:
			const { db, ranges } = createDb(() => 376);
			const estimator = createBlockFilesEstimator(db, 100);

			// Act: the second update joins the read in progress
			await Promise.all([estimator.update(10), estimator.update(20)]);

			// Assert:
			expect(ranges).to.deep.equal([[1, 10]]);
			expect(estimator.snapshot().height).to.equal(10);
		});

		it('averages the growth over the latest blocks', async () => {
			// Arrange: blocks 1-6 take 8 KB, blocks 7-10 take 12 KB (their .dat files are over 4 KB)
			const { db } = createDb(height => (6 >= height ? 376 : 5000));
			const estimator = createBlockFilesEstimator(db, 4);

			// Act:
			await estimator.update(10);

			// Assert:
			const snapshot = estimator.snapshot();
			expect(snapshot.diskBytes).to.equal((6 * 8192) + (4 * 12288));
			expect(snapshot.averageDiskBytes).to.equal(((6 * 8192) + (4 * 12288)) / 10);
			expect(snapshot.recentAverageDiskBytes).to.equal(12288);
		});
	});
});
