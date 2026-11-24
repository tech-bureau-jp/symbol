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

import { describeForks, forkDescriptions, parseForkHeights } from '../../../src/plugins/mijin/mijinForks.js';
import { expect } from 'chai';
import ini from 'ini';
import fs from 'fs';

describe('mijin forks', () => {
	const now = new Date('2026-11-24T00:00:00.000Z');
	const findFork = (result, name) => result.forks.find(fork => name === fork.name);

	it('parses fork heights with separators and lists', () => {
		expect(parseForkHeights('1\'200')).to.deep.equal([1200n]);
		expect(parseForkHeights('888\'888, 999\'999')).to.deep.equal([888888n, 999999n]);
		expect(parseForkHeights('0')).to.deep.equal([0n]);
		expect(parseForkHeights('abc')).to.deep.equal([]);
		expect(parseForkHeights(undefined)).to.deep.equal([]);
	});

	it('describes every fork height of the upstream sample config', () => {
		// Arrange:
		const sampleUrl = new URL('../../../../catapult/resources/config-network.properties', import.meta.url);
		const config = ini.parse(fs.readFileSync(sampleUrl, 'utf8'));

		// Act:
		const names = Object.keys(config.fork_heights);

		// Assert:
		expect(names.length).to.be.above(0);
		expect(names.filter(name => !forkDescriptions[name])).to.deep.equal([]);
	});

	it('returns the aggregate version before, between and after the forks', () => {
		// Arrange:
		const forkHeights = { strictAggregateTransactionHash: '100', uniqueAggregateTransactionHash: '1\'200' };

		// Act:
		const before = describeForks(forkHeights, 50n, 15, now).transactionVersions;
		const between = describeForks(forkHeights, 150n, 15, now).transactionVersions;
		const after = describeForks(forkHeights, 1200n, 15, now).transactionVersions;

		// Assert:
		expect([before.AGGREGATE_COMPLETE.current, before.AGGREGATE_COMPLETE.next, before.AGGREGATE_COMPLETE.switchHeight])
			.to.deep.equal([[1], [2], '100']);
		expect([between.AGGREGATE_COMPLETE.current, between.AGGREGATE_COMPLETE.next, between.AGGREGATE_COMPLETE.switchHeight,
			between.AGGREGATE_COMPLETE.blocksLeft]).to.deep.equal([[2], [3], '1200', '1050']);
		expect([after.AGGREGATE_COMPLETE.current, after.AGGREGATE_COMPLETE.next, after.AGGREGATE_COMPLETE.switchHeight])
			.to.deep.equal([[3], null, null]);
		expect(between.AGGREGATE_COMPLETE.type).to.equal(16705);
		expect(between.AGGREGATE_BONDED).to.deep.equal({ ...between.AGGREGATE_COMPLETE, type: 16961 });
	});

	it('treats a from fork at height 0 as active from the start', () => {
		// Act:
		const result = describeForks({ uniqueAggregateTransactionHash: '0', strictAggregateTransactionHash: '0' }, 5n, 15, now);

		// Assert:
		const fork = findFork(result, 'uniqueAggregateTransactionHash');
		expect([fork.active, fork.nextHeight]).to.deep.equal([true, null]);
		expect(result.transactionVersions.AGGREGATE_COMPLETE.current).to.deep.equal([3]);
	});

	it('prefers the later version when two forks share a height', () => {
		// Arrange:
		const forkHeights = { uniqueAggregateTransactionHash: '1200', strictAggregateTransactionHash: '1200' };

		// Act:
		const at = describeForks(forkHeights, 1200n, 15, now).transactionVersions.AGGREGATE_COMPLETE;
		const before = describeForks(forkHeights, 1199n, 15, now).transactionVersions.AGGREGATE_COMPLETE;

		// Assert:
		expect(at.current).to.deep.equal([3]);
		expect([before.current, before.next, before.switchHeight]).to.deep.equal([[1], [3], '1200']);
	});

	it('follows the later version when its fork is lower than the fork to the earlier version', () => {
		// Arrange: catapult checks the version 3 fork first, whatever the version 2 height is
		const v3First = { strictAggregateTransactionHash: '5000', uniqueAggregateTransactionHash: '0' };
		const v3Lower = { strictAggregateTransactionHash: '100', uniqueAggregateTransactionHash: '50' };

		// Act:
		const v3FirstAt10 = describeForks(v3First, 10n, 15, now).transactionVersions.AGGREGATE_COMPLETE;
		const v3FirstAt6000 = describeForks(v3First, 6000n, 15, now).transactionVersions.AGGREGATE_COMPLETE;
		const v3LowerAt10 = describeForks(v3Lower, 10n, 15, now).transactionVersions.AGGREGATE_COMPLETE;
		const v3LowerAt60 = describeForks(v3Lower, 60n, 15, now).transactionVersions.AGGREGATE_COMPLETE;

		// Assert:
		expect([v3FirstAt10.current, v3FirstAt10.next, v3FirstAt10.switchHeight]).to.deep.equal([[3], null, null]);
		expect([v3FirstAt6000.current, v3FirstAt6000.next]).to.deep.equal([[3], null]);
		expect([v3LowerAt10.current, v3LowerAt10.next, v3LowerAt10.switchHeight]).to.deep.equal([[1], [3], '50']);
		expect([v3LowerAt60.current, v3LowerAt60.next]).to.deep.equal([[3], null]);
	});

	it('lists the heights of an at fork and skips height 0', () => {
		// Arrange:
		const forkHeights = { skipSecretLockExpirations: '555\'555, 444\'444, 0' };

		// Act:
		const fork = findFork(describeForks(forkHeights, 500000n, 15, now), 'skipSecretLockExpirations');
		const passed = findFork(describeForks(forkHeights, 600000n, 15, now), 'skipSecretLockExpirations');

		// Assert:
		expect([fork.kind, fork.heights, fork.active, fork.nextHeight, fork.blocksLeft])
			.to.deep.equal(['at', ['0', '444444', '555555'], null, '555555', '55555']);
		expect(passed.nextHeight).to.equal(null);
	});

	it('estimates the time of the next height', () => {
		// Act:
		const fork = findFork(describeForks({ uniqueAggregateTransactionHash: '1200' }, 1000n, 15, now), 'uniqueAggregateTransactionHash');

		// Assert:
		expect(fork.estimatedAt).to.equal('2026-11-24T00:50:00.000Z');
	});

	it('returns an unknown fork without a description', () => {
		// Act:
		const result = describeForks({ mosaicDefinitionV2: '5000', futureLocks: '10, 20' }, 100n, 15, now);

		// Assert:
		const mosaicFork = findFork(result, 'mosaicDefinitionV2');
		expect([mosaicFork.kind, mosaicFork.description, mosaicFork.active]).to.deep.equal(['from', null, false]);
		expect(findFork(result, 'futureLocks').kind).to.equal('at');
		expect(result.transactionVersions).to.deep.equal({});
	});

	it('keeps a fork whose height is not a number', () => {
		// Act:
		const result = describeForks({ uniqueAggregateTransactionHash: 'soon' }, 100n, 15, now);

		// Assert:
		const fork = findFork(result, 'uniqueAggregateTransactionHash');
		expect([fork.heights, fork.active, fork.nextHeight]).to.deep.equal([[], null, null]);
		expect(result.transactionVersions.AGGREGATE_COMPLETE).to.equal(undefined);
	});

	it('describes the affected transactions with their types', () => {
		// Act:
		const { description } = findFork(describeForks({ vrfGammaSubgroupCheck: '1200' }, 100n, 15, now), 'vrfGammaSubgroupCheck');

		// Assert:
		expect(description.affects).to.deep.equal([{ type: 16963, name: 'VRF_KEY_LINK' }]);
		expect(description.rejectedWith).to.deep.equal(['Failure_Core_Invalid_Vrf_Key']);
		expect(description.versions).to.deep.equal({});
	});

	it('returns nothing without a fork_heights section', () => {
		expect(describeForks(undefined, 10n, 15, now)).to.deep.equal({ forks: [], transactionVersions: {} });
	});
});
