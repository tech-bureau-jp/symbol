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

import { models } from '@tech-bureau/symbol-sdk/symbol';

const Aggregate_Types = ['AGGREGATE_COMPLETE', 'AGGREGATE_BONDED'];

const aggregateVersions = (before, after) => Object.fromEntries(Aggregate_Types.map(name => [name, { before, after }]));

/**
 * What each [fork_heights] key of config-network.properties changes, read from the catapult code.
 * kind 'from': the change applies at and after the height (0 = from the start).
 * kind 'at': the change applies only in the blocks at the listed heights.
 * A key of a new upstream version must be added here; the test of the upstream sample config fails until it is.
 */
export const forkDescriptions = {
	strictAggregateTransactionHash: {
		kind: 'from',
		affects: Aggregate_Types,
		versions: aggregateVersions([1], [2]),
		change: 'aggregate transactions must be version 2 (the hash covers the cosignatures)',
		rejectedWith: ['Failure_Aggregate_V1_Prohibited', 'Failure_Aggregate_V3_Prohibited']
	},
	uniqueAggregateTransactionHash: {
		kind: 'from',
		affects: Aggregate_Types,
		versions: aggregateVersions([2], [3]),
		change: 'aggregate transactions must be version 3 (the hash is unique per aggregate)',
		rejectedWith: ['Failure_Aggregate_V2_Prohibited']
	},
	vrfGammaSubgroupCheck: {
		kind: 'from',
		affects: ['VRF_KEY_LINK'],
		change: 'a link to an invalid VRF public key is rejected, and block VRF proofs are checked strictly (gamma subgroup, neutral key)',
		rejectedWith: ['Failure_Core_Invalid_Vrf_Key']
	},
	strictVrfPublicKeyCheck: {
		kind: 'from',
		affects: [],
		change: 'the VRF public key of a block proof is checked strictly (blocks only, no transaction changes)',
		rejectedWith: []
	},
	totalVotingBalanceCalculationFix: {
		kind: 'from',
		affects: [],
		change: 'the total voting balance is calculated with the fix',
		rejectedWith: []
	},
	treasuryReissuance: {
		kind: 'from',
		affects: [],
		change: 'the treasury reissuance of the Symbol mainnet',
		rejectedWith: []
	},
	skipSecretLockUniquenessChecks: {
		kind: 'at',
		affects: ['SECRET_LOCK'],
		change: 'the secret lock uniqueness check is skipped in the blocks at these heights (Symbol mainnet)',
		rejectedWith: []
	},
	skipSecretLockExpirations: {
		kind: 'at',
		affects: ['SECRET_LOCK'],
		change: 'secret lock expirations are skipped in the blocks at these heights (Symbol mainnet)',
		rejectedWith: []
	},
	forceSecretLockExpirations: {
		kind: 'at',
		affects: ['SECRET_LOCK'],
		change: 'secret locks are forced to expire in the blocks at these heights (Symbol mainnet)',
		rejectedWith: []
	}
};

/**
 * Parses a fork height value: one height (1'200) or a list (888'888, 999'999).
 * @param {string} value Value in config-network.properties.
 * @returns {Array<bigint>} Heights, empty when the value is not a list of numbers.
 */
export const parseForkHeights = value => {
	const parts = String(value ?? '').split(',').map(part => part.replace(/'/g, '').trim());
	return parts.every(part => /^\d+$/.test(part)) ? parts.map(part => BigInt(part)) : [];
};

const transactionType = name => models.TransactionType[name].value;

const estimate = (height, nextHeight, secondsPerBlock, now) => {
	if (undefined === nextHeight)
		return { nextHeight: null, blocksLeft: null, estimatedAt: null };

	const blocksLeft = nextHeight - height;
	return {
		nextHeight: nextHeight.toString(),
		blocksLeft: blocksLeft.toString(),
		estimatedAt: new Date(now.getTime() + (Number(blocksLeft) * secondsPerBlock * 1000)).toISOString()
	};
};

const describeFork = (name, value, height, secondsPerBlock, now) => {
	const description = forkDescriptions[name];
	const kind = description ? description.kind : (String(value).includes(',') ? 'at' : 'from');
	const heights = parseForkHeights(value).sort((lhs, rhs) => (lhs < rhs ? -1 : (lhs > rhs ? 1 : 0)));

	let active = null;
	if ('from' === kind && heights.length)
		active = height >= heights[0];

	const nextHeight = heights.find(forkHeight => forkHeight > height && ('from' === kind || 0n !== forkHeight));
	return {
		name,
		kind,
		heights: heights.map(forkHeight => forkHeight.toString()),
		active,
		...estimate(height, nextHeight, secondsPerBlock, now),
		description: description
			? {
				affects: description.affects.map(affected => ({ type: transactionType(affected), name: affected })),
				versions: description.versions || {},
				change: description.change,
				rejectedWith: description.rejectedWith
			}
			: null
	};
};

const describeTransactionVersions = (forkHeights, height, secondsPerBlock, now) => {
	const switches = {};
	Object.keys(forkHeights).forEach(name => {
		const description = forkDescriptions[name];
		const heights = parseForkHeights(forkHeights[name]);
		if (!description || 'from' !== description.kind || !description.versions || !heights.length)
			return;

		Object.entries(description.versions).forEach(([transactionName, versions]) => {
			switches[transactionName] = switches[transactionName] || [];
			switches[transactionName].push({ height: heights[0], ...versions });
		});
	});

	const transactionVersions = {};
	const latestVersion = forkSwitch => Math.max(...forkSwitch.after);
	Object.keys(switches).sort().forEach(transactionName => {
		// catapult checks the fork to the latest version first, whatever the heights of the others:
		// the passed fork to the latest version decides, and only a fork to a later version can change it
		const byVersion = switches[transactionName].sort((lhs, rhs) => latestVersion(lhs) - latestVersion(rhs));
		const passed = byVersion.filter(forkSwitch => height >= forkSwitch.height);
		const current = passed.length ? passed[passed.length - 1].after : byVersion[0].before;
		const pending = byVersion
			.filter(forkSwitch => height < forkSwitch.height && latestVersion(forkSwitch) > Math.max(...current))
			// the nearest height; at one height, the fork to the latest version is what the node applies
			.sort((lhs, rhs) => {
				if (lhs.height !== rhs.height)
					return lhs.height < rhs.height ? -1 : 1;

				return latestVersion(rhs) - latestVersion(lhs);
			})[0];
		const estimated = estimate(height, pending && pending.height, secondsPerBlock, now);
		transactionVersions[transactionName] = {
			type: transactionType(transactionName),
			current,
			next: pending ? pending.after : null,
			switchHeight: estimated.nextHeight,
			blocksLeft: estimated.blocksLeft,
			estimatedAt: estimated.estimatedAt
		};
	});

	return transactionVersions;
};

/**
 * Describes the fork heights at the given chain height.
 * @param {object} forkHeights [fork_heights] section of config-network.properties (undefined when missing).
 * @param {bigint} height Chain height.
 * @param {number} secondsPerBlock Seconds per block for the estimates.
 * @param {Date} now Current time for the estimates.
 * @returns {object} Forks and the transaction versions they switch.
 */
export const describeForks = (forkHeights, height, secondsPerBlock, now) => {
	if (!forkHeights)
		return { forks: [], transactionVersions: {} };

	return {
		forks: Object.keys(forkHeights).sort().map(name => describeFork(name, forkHeights[name], height, secondsPerBlock, now)),
		transactionVersions: describeTransactionVersions(forkHeights, height, secondsPerBlock, now)
	};
};
