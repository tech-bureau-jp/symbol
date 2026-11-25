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

/** @module plugins/mijin/mijinNetworks */

import { Hash256 } from '@tech-bureau/symbol-sdk';
import { Network } from '@tech-bureau/symbol-sdk/symbol';

const Epoch_Time = new Date(Date.UTC(2019, 6, 11, 23, 0, 0));

// REST uses the network for its name, identifier and epoch only
const Dummy_Generation_Hash_Seed = new Hash256('FF'.repeat(32));

const networks = [
	new Network('mijin', 0x60, Epoch_Time, Dummy_Generation_Hash_Seed),
	new Network('mijinTest', 0x90, Epoch_Time, Dummy_Generation_Hash_Seed)
];

/**
 * Finds a mijin network, which the SDK does not know.
 * @param {string} name Network name.
 * @returns {Network|undefined} Network, or undefined when the name is not a mijin network.
 */
const findMijinNetwork = name => networks.find(network => name === network.name);

export default findMijinNetwork;
