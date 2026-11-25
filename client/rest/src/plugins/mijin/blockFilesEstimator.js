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

/** @module plugins/mijin/blockFilesEstimator */

import MongoDb from 'mongodb';

const { Long } = MongoDb;

export const File_System_Block_Size = 4096;

/**
 * Converts a mongo value (number, Long or Int32) to a number.
 * @param {object} value Value.
 * @returns {number} Number.
 */
export const toNumber = value => {
	if (undefined === value || null === value)
		return 0;

	return 'function' === typeof value.toNumber ? value.toNumber() : Number(value.valueOf());
};

/**
 * Size of the .dat file of a block when the node writes one file per block (fileDatabaseBatchSize = 1):
 * the block, its entity and generation hashes, the hashes of its transactions and the sub cache merkle roots.
 * @param {object} block Block.
 * @param {number} block.size Block size.
 * @param {number} block.transactionsCount Number of top level transactions.
 * @param {number} block.subCacheMerkleRootsCount Number of sub cache merkle roots.
 * @returns {number} File size in bytes.
 */
export const blockFileSize = block =>
	block.size + (2 * 32) + 4 + (block.transactionsCount * 2 * 32) + 4 + (block.subCacheMerkleRootsCount * 32);

/**
 * Space a file of this size takes on disk.
 * @param {number} bytes File size.
 * @returns {number} Bytes on disk.
 */
export const diskSize = bytes => Math.ceil(bytes / File_System_Block_Size) * File_System_Block_Size;

/**
 * Space the files of a block take on disk: the .dat file and the .stmt file. The size of the .stmt file is not in
 * the database; it is counted as one file system block, which it is unless the block has many receipts.
 * @param {object} block Block as passed to blockFileSize.
 * @returns {number} Bytes on disk.
 */
export const blockDiskSize = block => diskSize(blockFileSize(block)) + File_System_Block_Size;

/**
 * Creates an estimator of the block files that reads every block once: the first update reads the blocks up to
 * the given height, the next ones only the blocks above the last height read (a range of the block.height index).
 * @param {object} db Catapult database.
 * @param {number} recentBlocksCount Number of the latest blocks whose average gives the growth.
 * @returns {object} Estimator.
 */
export const createBlockFilesEstimator = (db, recentBlocksCount) => {
	const state = {
		height: 0,
		fileBytes: 0,
		diskBytes: 0,
		recent: [],
		recentDiskBytes: 0
	};
	let pendingUpdate = null;

	const add = block => {
		const fileBytes = blockFileSize(block);
		const blockDiskBytes = blockDiskSize(block);
		state.fileBytes += fileBytes;
		state.diskBytes += blockDiskBytes;

		state.recent.push(blockDiskBytes);
		state.recentDiskBytes += blockDiskBytes;
		if (state.recent.length > recentBlocksCount)
			state.recentDiskBytes -= state.recent.shift();

		state.height = block.height;
	};

	const read = async height => {
		const cursor = db.database.collection('blocks').aggregate([
			{ $match: { 'block.height': { $gt: Long.fromNumber(state.height), $lte: Long.fromNumber(height) } } },
			{ $sort: { 'block.height': 1 } },
			{
				$project: {
					_id: 0,
					height: '$block.height',
					size: '$block.size',
					transactionsCount: '$meta.transactionsCount',
					subCacheMerkleRootsCount: { $size: { $ifNull: ['$meta.stateHashSubCacheMerkleRoots', []] } }
				}
			}
		]);

		for await (const block of cursor) {
			add({
				height: toNumber(block.height),
				size: toNumber(block.size),
				transactionsCount: toNumber(block.transactionsCount),
				subCacheMerkleRootsCount: block.subCacheMerkleRootsCount
			});
		}
	};

	return {
		/**
		 * Reads the blocks above the last height read, up to height. Only one read runs at a time.
		 * @param {number} height Height to read up to.
		 * @returns {Promise} Promise resolved when this read is done.
		 */
		update: height => {
			if (!pendingUpdate && height > state.height) {
				pendingUpdate = read(height).finally(() => {
					pendingUpdate = null;
				});
			}

			return pendingUpdate || Promise.resolve();
		},

		/**
		 * Gets what has been read so far.
		 * @returns {object} Last height read, sizes of the files read, and average bytes on disk per block.
		 */
		snapshot: () => ({
			height: state.height,
			fileBytes: state.fileBytes,
			diskBytes: state.diskBytes,
			averageDiskBytes: 0 === state.height ? 0 : state.diskBytes / state.height,
			recentAverageDiskBytes: 0 === state.recent.length ? 0 : state.recentDiskBytes / state.recent.length
		})
	};
};
