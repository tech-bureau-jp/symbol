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

import findMijinNetwork from '../../../src/plugins/mijin/mijinNetworks.js';
import { expect } from 'chai';

describe('mijin networks', () => {
	it('finds mijin and mijinTest', () => {
		// Act:
		const mijin = findMijinNetwork('mijin');
		const mijinTest = findMijinNetwork('mijinTest');

		// Assert:
		expect([mijin.name, mijin.identifier]).to.deep.equal(['mijin', 0x60]);
		expect([mijinTest.name, mijinTest.identifier]).to.deep.equal(['mijinTest', 0x90]);
		expect(mijin.datetimeConverter.epoch).to.deep.equal(new Date(Date.UTC(2019, 6, 11, 23, 0, 0)));
	});

	it('does not find the other networks', () => {
		expect(findMijinNetwork('mainnet')).to.equal(undefined);
		expect(findMijinNetwork('testnet')).to.equal(undefined);
	});
});
