#!/usr/bin/env python
# pylint: disable=too-many-lines

import asyncio
import json
import shutil
import time

from aiohttp import ClientSession

from symbolchain.Bip32 import Bip32
from symbolchain.CryptoTypes import Hash256, PrivateKey
from symbolchain.facade.SymbolFacade import SymbolFacade
from symbolchain.sc import Amount, Cosignature, PublicKey, Signature
from symbolchain.symbol.IdGenerator import generate_mosaic_alias_id, generate_mosaic_id, generate_namespace_id
from symbolchain.symbol.Metadata import metadata_update_value
from symbolchain.symbol.Network import NetworkTimestamp  # TODO_: should we link this to Facade or Network to avoid direct import?

SYMBOL_API_ENDPOINT = 'https://sym-test-02.opening-line.jp:3001'
SYMBOL_TOOLS_ENDPOINT = 'https://testnet.symbol.tools'
SYMBOL_EXPLORER_TRANSACTION_URL_PATTERN = 'https://testnet.symbol.fyi/transactions/{}'


# region create empty account

def create_random_account(facade):
	# create a signing key pair that will be associated with an account
	key_pair = facade.KeyPair(PrivateKey.random())

	# convert the public key to a network-dependent address (unique account identifier)
	address = facade.network.public_key_to_address(key_pair.public_key)

	# output account public and private details
	print(f'    address: {address}')
	print(f' public key: {key_pair.public_key}')
	print(f'private key: {key_pair.private_key}')


def create_random_bip32_account(facade):
	# create a random Bip39 seed phrase (mnemonic)
	bip32 = Bip32()
	mnemonic = bip32.random()

	# derive a root Bip32 node from the mnemonic and a password 'correcthorsebatterystaple'
	root_node = bip32.from_mnemonic(mnemonic, 'correcthorsebatterystaple')

	# derive a child Bip32 node from the root Bip32 node for the account at index 0
	child_node = root_node.derive_path(facade.bip32_path(0))

	# convert the Bip32 node to a signing key pair
	key_pair = facade.bip32_node_to_key_pair(child_node)

	# convert the public key to a network-dependent address (unique account identifier)
	address = facade.network.public_key_to_address(key_pair.public_key)

	# output account public and private details
	print(f'   mnemonic: {mnemonic}')
	print(f'    address: {address}')
	print(f' public key: {key_pair.public_key}')
	print(f'private key: {key_pair.private_key}')

# endregion


# region create account with faucet

async def wait_for_confirmed_transaction(transaction_hash, **kwargs):
	transaction_description = kwargs.get('transaction_description', 'transaction')
	async with ClientSession(raise_for_status=False) as session:
		for _ in range(600):
			# query the status of the transaction
			async with session.get(f'{SYMBOL_API_ENDPOINT}/transactionStatus/{transaction_hash}') as response:
				# wait for the (JSON) response
				response_json = await response.json()

				# check if the transaction is confirmed
				if 200 == response.status:
					status = response_json['group']
					print(f'{transaction_description} {transaction_hash} has status "{status}"')
					if 'confirmed' == status:
						explorer_url = SYMBOL_EXPLORER_TRANSACTION_URL_PATTERN.format(transaction_hash)
						print(f'{transaction_description} was confirmed: {explorer_url}')
						return

					if 'failed' == status:
						print(f'{transaction_description} failed validation: {response_json["code"]}')
						break
				else:
					print(f'{transaction_description} {transaction_hash} has unknown status')

			# if not, wait 20s before trying again
			time.sleep(20)

		# fail if the transaction didn't transition to the desired status after 10m
		raise RuntimeError(f'{transaction_description} {transaction_hash} was not confirmed in alloted time period')


async def create_account_with_tokens_from_faucet(facade, amount=100):  # pylint: disable=invalid-name
	# create a key pair that will be used to send transactions
	# when the PrivateKey is known, pass the raw private key bytes or hex encoded string to the PrivateKey(...) constructor instead
	key_pair = facade.KeyPair(PrivateKey.random())
	address = facade.network.public_key_to_address(key_pair.public_key)
	print(f'new account created with address: {address}')

	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP POST request to faucet endpoint
		request = {
			'recipient': str(address),
			'amount': amount,
			'selectedMosaics': ['3A8416DB2D53B6C8']  # XYM mosaic id on testnet
		}
		async with session.post(f'{SYMBOL_TOOLS_ENDPOINT}/claims', json=request) as response:
			# wait for the (JSON) response
			response_json = await response.json()

			# extract the funding transaction hash and wait for it to be confirmed
			transaction_hash = Hash256(response_json['txHash'])
			await wait_for_confirmed_transaction(transaction_hash, transaction_description='funding transaction')

	return key_pair

# endregion


# region network property accessors

async def get_network_time():
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP GET request to a Symbol REST endpoint
		async with session.get(f'{SYMBOL_API_ENDPOINT}/node/time') as response:
			# wait for the (JSON) response
			response_json = await response.json()

			# extract the network time from the json
			timestamp = NetworkTimestamp(int(response_json['communicationTimestamps']['receiveTimestamp']))
			print(f'network time: {timestamp} ms')
			return timestamp


async def get_maximum_supply():
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP GET request to a Symbol REST endpoint
		async with session.get(f'{SYMBOL_API_ENDPOINT}/network/currency/supply/max') as response:
			# wait for the (text) response and interpret it as a floating point value
			maximum_supply = float(await response.text())
			print(f'maximum supply: {maximum_supply:.6f} XYM')
			return maximum_supply


async def get_total_supply():
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP GET request to a Symbol REST endpoint
		async with session.get(f'{SYMBOL_API_ENDPOINT}/network/currency/supply/total') as response:
			# wait for the (text) response and interpret it as a floating point value
			total_supply = float(await response.text())
			print(f'total supply: {total_supply:.6f} XYM')
			return total_supply


async def get_circulating_supply():
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP GET request to a Symbol REST endpoint
		async with session.get(f'{SYMBOL_API_ENDPOINT}/network/currency/supply/circulating') as response:
			# wait for the (text) response and interpret it as a floating point value
			circulating_supply = float(await response.text())
			print(f'circulating supply: {circulating_supply:.6f} XYM')
			return circulating_supply


async def get_network_height():
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP GET request to a Symbol REST endpoint
		async with session.get(f'{SYMBOL_API_ENDPOINT}/chain/info') as response:
			# wait for the (JSON) response
			response_json = await response.json()

			# extract the height from the json
			height = int(response_json['height'])
			print(f'height: {height}')
			return height


async def get_network_finalized_height():
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP GET request to a Symbol REST endpoint
		async with session.get(f'{SYMBOL_API_ENDPOINT}/chain/info') as response:
			# wait for the (JSON) response
			response_json = await response.json()

			# extract the finalized height from the json
			height = int(response_json['latestFinalizedBlock']['height'])
			print(f'finalized height: {height}')
			return height

# endregion


# region account transactions

async def create_account_metadata_transaction_new(facade, signer_key_pair):  # pylint: disable=invalid-name
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	# metadata transaction needs to be wrapped in aggregate transaction

	value = 'https://twitter.com/NCOSIGIMCITYNREmalformed'.encode('utf8')

	embedded_transactions = [
		facade.transaction_factory.create_embedded({
			'type': 'account_metadata_transaction',
			'signer_public_key': signer_key_pair.public_key,

			'target_address': facade.network.public_key_to_address(signer_key_pair.public_key),
			'scoped_metadata_key': 0x72657474697774,  # this can be any value picked by creator
			'value_size_delta': len(value),  # when creating _new_ value this needs to be equal to value size
			'value': value
		})
	]
	# create the transaction
	transaction = facade.transaction_factory.create({
		'signer_public_key': signer_key_pair.public_key,
		'deadline': network_time.timestamp,

		'type': 'aggregate_complete_transaction',
		'transactions_hash': facade.hash_embedded_transactions(embedded_transactions).bytes,
		'transactions': embedded_transactions
	})

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(signer_key_pair, transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'account metadata (new) transaction hash {transaction_hash}')

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='account metadata (new) transaction')


async def create_account_metadata_transaction_modify(facade, signer_key_pair):  # pylint: disable=invalid-name
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	# metadata transaction needs to be wrapped in aggregate transaction

	# to update existing metadata, new value needs to be 'xored' with previous value.
	old_value = 'https://twitter.com/NCOSIGIMCITYNREmalformed'.encode('utf8')
	new_value = 'https://twitter.com/0x6861746366574'.encode('utf8')
	update_value = metadata_update_value(old_value, new_value)

	embedded_transactions = [
		facade.transaction_factory.create_embedded({
			'type': 'account_metadata_transaction',
			'signer_public_key': signer_key_pair.public_key,

			'target_address': facade.network.public_key_to_address(signer_key_pair.public_key),
			'scoped_metadata_key': 0x72657474697774,  # when updating existing value, both target_address and key must match previously set
			'value_size_delta': len(new_value) - len(old_value),  # change in size, negative because the value will be shrunk
			'value': update_value
		})
	]
	# create the transaction
	transaction = facade.transaction_factory.create({
		'signer_public_key': signer_key_pair.public_key,
		'deadline': network_time.timestamp,

		'type': 'aggregate_complete_transaction',
		'transactions_hash': facade.hash_embedded_transactions(embedded_transactions).bytes,
		'transactions': embedded_transactions
	})

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(signer_key_pair, transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'account metadata (modify) transaction hash {transaction_hash}')

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='account metadata (modify) transaction')


# endregion


# region account multisig management transactions

async def create_multisig_account_modification_transaction_new_account(facade, signer_key_pair):  # pylint: disable=invalid-name
	# pylint: disable=too-many-locals
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	# create cosignatory key pairs, where each cosignatory will be required to cosign initial modification
	# (they are insecurely deterministically generated for the benefit of create_multisig_account_modification_transaction_modify_account)
	cosignatory_key_pairs = [facade.KeyPair(PrivateKey(signer_key_pair.private_key.bytes[:-1] + bytes([i]))) for i in range(3)]
	cosignatory_addresses = [facade.network.public_key_to_address(key_pair.public_key) for key_pair in cosignatory_key_pairs]

	# multisig account modification transaction needs to be wrapped in aggregate transaction

	# to update existing metadata, new value needs to be 'xored' with previous value.
	embedded_transactions = [
		facade.transaction_factory.create_embedded({
			'type': 'multisig_account_modification_transaction',
			'signer_public_key': signer_key_pair.public_key,

			'min_approval_delta': 2,  # number of signatures required to make any transaction
			'min_removal_delta': 2,  # number of signatures needed to remove a cosignatory from multisig
			'address_additions': cosignatory_addresses
		})
	]

	# create the transaction, notice that signer account that will be turned into multisig is a signer of transaction
	transaction = facade.transaction_factory.create({
		'signer_public_key': signer_key_pair.public_key,
		'deadline': network_time.timestamp,

		'type': 'aggregate_complete_transaction',
		'transactions_hash': facade.hash_embedded_transactions(embedded_transactions).bytes,
		'transactions': embedded_transactions
	})

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(signer_key_pair, transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'multisig account modification (create) transaction hash {transaction_hash}')

	# cosign transaction by all partners (this is dependent on the hash and consequently the main signature)
	for cosignatory_key_pair in cosignatory_key_pairs:
		cosignature = Cosignature()
		cosignature.version = 0
		cosignature.signer_public_key = PublicKey(cosignatory_key_pair.public_key.bytes)
		cosignature.signature = Signature(cosignatory_key_pair.sign(transaction_hash.bytes).bytes)
		transaction.cosignatures.append(cosignature)

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='multisig account modification (create) transaction')


async def create_multisig_account_modification_transaction_modify_account(facade, signer_key_pair):  # pylint: disable=invalid-name
	# pylint: disable=too-many-locals
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	cosignatory_key_pairs = [facade.KeyPair(PrivateKey(signer_key_pair.private_key.bytes[:-1] + bytes([i]))) for i in range(4)]
	cosignatory_addresses = [facade.network.public_key_to_address(key_pair.public_key) for key_pair in cosignatory_key_pairs]

	# multisig account modification transaction needs to be wrapped in aggregate transaction

	# to update existing metadata, new value needs to be 'xored' with previous value.
	embedded_transactions = [
		# create a transfer from the multisig account to the primary cosignatory to cover the transaction fee
		facade.transaction_factory.create_embedded({
			'type': 'transfer_transaction',
			'signer_public_key': signer_key_pair.public_key,

			'recipient_address': cosignatory_addresses[0],
			'mosaics': [
				{'mosaic_id': generate_mosaic_alias_id('symbol.xym'), 'amount': 5_000000}
			]
		}),

		facade.transaction_factory.create_embedded({
			'type': 'multisig_account_modification_transaction',
			'signer_public_key': signer_key_pair.public_key,  # sender of modification transaction is multisig account

			# don't change number of cosignature needed for transactions
			'min_approval_delta': 0,
			# decrease number of signatures needed to remove a cosignatory from multisig (optional)
			'min_removal_delta': -1,
			'address_additions': [cosignatory_addresses[3]],
			'address_deletions': [cosignatory_addresses[1]]
		})
	]

	# create the transaction, notice that account that will be turned into multisig is a signer of transaction
	transaction = facade.transaction_factory.create({
		'signer_public_key': cosignatory_key_pairs[0].public_key,  # signer of the aggregate is one of the two cosignatories
		'deadline': network_time.timestamp,

		'type': 'aggregate_complete_transaction',
		'transactions_hash': facade.hash_embedded_transactions(embedded_transactions).bytes,
		'transactions': embedded_transactions
	})

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(cosignatory_key_pairs[0], transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'multisig account modification (modify) transaction hash {transaction_hash}')

	# cosign transaction by all partners (this is dependent on the hash and consequently the main signature)
	for cosignatory_key_pair in [cosignatory_key_pairs[2], cosignatory_key_pairs[3]]:
		cosignature = Cosignature()
		cosignature.version = 0
		cosignature.signer_public_key = PublicKey(cosignatory_key_pair.public_key.bytes)
		cosignature.signature = Signature(cosignatory_key_pair.sign(transaction_hash.bytes).bytes)
		transaction.cosignatures.append(cosignature)

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='multisig account modification (modify) transaction')


# endregion


# region namespace transactions

async def create_namespace_registration_transaction_root(facade, signer_key_pair):  # pylint: disable=invalid-name
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	# create the transaction
	namespace_name = f'who_{str(signer_address).lower()}'
	transaction = facade.transaction_factory.create({
		'signer_public_key': signer_key_pair.public_key,
		'deadline': network_time.timestamp,

		'type': 'namespace_registration_transaction',
		'registration_type': 'root',  # 'root' indicates a root namespace is being created
		'duration': 86400,  # number of blocks the root namespace will be active; approximately 30 (86400 / 2880) days
		'name': namespace_name  # name of the root namespace
	})

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(signer_key_pair, transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'namespace (root) registration transaction hash {transaction_hash}')

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='namespace (root) registration transaction')


async def create_namespace_registration_transaction_child(facade, signer_key_pair):  # pylint: disable=invalid-name
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	# create the transaction
	root_namespace_name = f'who_{str(signer_address).lower()}'
	transaction = facade.transaction_factory.create({
		'signer_public_key': signer_key_pair.public_key,
		'deadline': network_time.timestamp,

		'type': 'namespace_registration_transaction',
		'registration_type': 'child',  # 'child' indicates a namespace will be attach to some existing root namespace
		'parent_id': generate_namespace_id(root_namespace_name),  # this points to root namespace
		'name': 'killed'  # name of the child namespace
	})

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(signer_key_pair, transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'namespace (child) registration transaction hash {transaction_hash}')

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='namespace (child) registration transaction')


async def create_namespace_metadata_transaction_new(facade, signer_key_pair):  # pylint: disable=invalid-name
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	# metadata transaction needs to be wrapped in aggregate transaction

	root_namespace_name = f'who_{str(signer_address).lower()}'
	value = 'Laura Palmer'.encode('utf8')

	embedded_transactions = [
		facade.transaction_factory.create_embedded({
			'type': 'namespace_metadata_transaction',
			'signer_public_key': signer_key_pair.public_key,

			'target_namespace_id': generate_namespace_id('killed', generate_namespace_id(root_namespace_name)),

			# the key consists of pair (target_address, scoped_metadata_key), if target address
			# is not signer, the account will need to cosign this transaction
			'target_address': facade.network.public_key_to_address(signer_key_pair.public_key),
			'scoped_metadata_key': 0x656d616e,

			'value_size_delta': len(value),
			'value': value
		})
	]
	# create the transaction
	transaction = facade.transaction_factory.create({
		'signer_public_key': signer_key_pair.public_key,
		'deadline': network_time.timestamp,

		'type': 'aggregate_complete_transaction',
		'transactions_hash': facade.hash_embedded_transactions(embedded_transactions).bytes,
		'transactions': embedded_transactions
	})

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(signer_key_pair, transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'namespace metadata (new) transaction hash {transaction_hash}')

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='namespace metadata (new) transaction')


async def create_namespace_metadata_transaction_modify(facade, signer_key_pair):  # pylint: disable=invalid-name,too-many-locals
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	# metadata transaction needs to be wrapped in aggregate transaction

	root_namespace_name = f'who_{str(signer_address).lower()}'
	old_value = 'Laura Palmer'.encode('utf8')
	new_value = 'Catherine Martell'.encode('utf8')
	update_value = metadata_update_value(old_value, new_value)

	embedded_transactions = [
		facade.transaction_factory.create_embedded({
			'type': 'namespace_metadata_transaction',
			'signer_public_key': signer_key_pair.public_key,

			'target_namespace_id': generate_namespace_id('killed', generate_namespace_id(root_namespace_name)),

			# to update existing metadata, key which consists of pair (target_address, scoped_metadata_key),
			# needs to match previously set key
			# if target address is not signer, the update will require cosignature
			'target_address': facade.network.public_key_to_address(signer_key_pair.public_key),
			'scoped_metadata_key': 0x656d616e,

			'value_size_delta': len(new_value) - len(old_value),
			'value': update_value
		})
	]
	# create the transaction
	transaction = facade.transaction_factory.create({
		'signer_public_key': signer_key_pair.public_key,
		'deadline': network_time.timestamp,

		'type': 'aggregate_complete_transaction',
		'transactions_hash': facade.hash_embedded_transactions(embedded_transactions).bytes,
		'transactions': embedded_transactions
	})

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(signer_key_pair, transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'namespace metadata (modify) transaction hash {transaction_hash}')

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='namespace metadata (modify) transaction')


# endregion


# region mosaic transactions

async def create_mosaic_definition_transaction(facade, signer_key_pair):
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	transaction = facade.transaction_factory.create({
		'signer_public_key': signer_key_pair.public_key,
		'deadline': network_time.timestamp,

		'type': 'mosaic_definition_transaction',
		'duration': 0,  # number of blocks the mosaic will be active; 0 indicates it will never expire
		'divisibility': 2,  # number of supported decimal places

		# nonce is used as a locally unique identifier for mosaics with a common owner
		# mosaic id is dreived from the owner's address and the nonce
		'nonce': 123,

		# set of restrictions to apply to the mosaic
		# - 'transferable' indicates the mosaic can be freely transfered among any account that can own the mosaic
		# - 'restrictable' indicates that the owner can restrict the accounts that can own the mosaic
		'flags': 'transferable restrictable'
	})

	# transaction.id field is mosaic id and it is filled automatically after calling transaction_factory.create()

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(signer_key_pair, transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'mosaic definition transaction hash {transaction_hash}')

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='mosaic definition transaction')


async def create_mosaic_supply_transaction(facade, signer_key_pair):
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	transaction = facade.transaction_factory.create({
		'signer_public_key': signer_key_pair.public_key,
		'deadline': network_time.timestamp,

		'type': 'mosaic_supply_change_transaction',
		'mosaic_id': generate_mosaic_id(signer_address, 123),

		# action can either be 'increase' or 'decrease',
		# if mosaic does not have 'mutable supply' flag, owner can issue supply change transactions only if owns full supply
		'action': 'increase',

		# delta is always unsigned number, it's specified in atomic units, created mosaic has divisibility set to 2 decimal places,
		# so following delta will result in 100 units
		'delta': 100_00
	})

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(signer_key_pair, transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'mosaic supply transaction hash {transaction_hash}')

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='mosaic supply transaction')


async def create_global_mosaic_restriction_transaction_new(facade, signer_key_pair):  # pylint: disable=invalid-name
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	transaction = facade.transaction_factory.create({
		'signer_public_key': signer_key_pair.public_key,
		'deadline': network_time.timestamp,

		'type': 'mosaic_global_restriction_transaction',
		'mosaic_id': generate_mosaic_id(signer_address, 123),

		# restriction might use some other mosaic restriction rules, that mosaic doesn't even have to belong to current owner
		'reference_mosaic_id': 0,
		'restriction_key': 0xC0FFE,
		'previous_restriction_type': 0,  # this is newly created restriction so there was no previous type
		'previous_restriction_value': 0,

		# 'ge' means greater or equal, possible operators are: 'eq', 'ne', 'lt', 'le', 'gt', 'ge'
		'new_restriction_type': 'ge',
		'new_restriction_value': 1
	})

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(signer_key_pair, transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'global mosaic restriction (new) transaction hash {transaction_hash}')

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='global mosaic restriction (new) transaction')


async def create_address_mosaic_restriction_transaction_1(facade, signer_key_pair):  # pylint: disable=invalid-name
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	transaction = facade.transaction_factory.create({
		'signer_public_key': signer_key_pair.public_key,
		'deadline': network_time.timestamp,

		'type': 'mosaic_address_restriction_transaction',
		'mosaic_id': generate_mosaic_id(signer_address, 123),

		'restriction_key': 0xC0FFE,
		'previous_restriction_value': 0xFFFFFFFF_FFFFFFFF,
		'new_restriction_value': 10,
		'target_address': facade.network.public_key_to_address(signer_key_pair.public_key)
	})

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(signer_key_pair, transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'address mosaic restriction (new - 1) transaction hash {transaction_hash}')

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='address mosaic restriction (new - 1) transaction')


async def create_address_mosaic_restriction_transaction_2(facade, signer_key_pair):  # pylint: disable=invalid-name
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	transaction = facade.transaction_factory.create({
		'signer_public_key': signer_key_pair.public_key,
		'deadline': network_time.timestamp,

		'type': 'mosaic_address_restriction_transaction',
		'mosaic_id': generate_mosaic_id(signer_address, 123),

		'restriction_key': 0xC0FFE,
		'previous_restriction_value': 0xFFFFFFFF_FFFFFFFF,
		'new_restriction_value': 1,
		'target_address': SymbolFacade.Address('TBOBBYKOYQBWK3HSX7NQVJ5JFPE22352AVDXXAA')
	})

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(signer_key_pair, transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'address mosaic restriction (new - 2) transaction hash {transaction_hash}')

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='address mosaic restriction (new - 2) transaction')


async def create_address_mosaic_restriction_transaction_3(facade, signer_key_pair):  # pylint: disable=invalid-name
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	transaction = facade.transaction_factory.create({
		'signer_public_key': signer_key_pair.public_key,
		'deadline': network_time.timestamp,

		'type': 'mosaic_address_restriction_transaction',
		'mosaic_id': generate_mosaic_id(signer_address, 123),

		'restriction_key': 0xC0FFE,
		'previous_restriction_value': 0xFFFFFFFF_FFFFFFFF,
		'new_restriction_value': 2,
		'target_address': SymbolFacade.Address('TALICECI35BNIJQA5CNUKI2DY3SXNEHPZJSOVAA')
	})

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(signer_key_pair, transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'address mosaic restriction (new - 3) transaction hash {transaction_hash}')

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='address mosaic restriction (new - 3) transaction')


async def create_global_mosaic_restriction_transaction_modify(facade, signer_key_pair):  # pylint: disable=invalid-name
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	transaction = facade.transaction_factory.create({
		'signer_public_key': signer_key_pair.public_key,
		'deadline': network_time.timestamp,

		'type': 'mosaic_global_restriction_transaction',
		'mosaic_id': generate_mosaic_id(signer_address, 123),

		'reference_mosaic_id': 0,
		'restriction_key': 0xC0FFE,
		'previous_restriction_type': 'ge',  # must match old restriction type
		'previous_restriction_value': 1,  # must match old restriction value

		'new_restriction_type': 'ge',
		'new_restriction_value': 2
	})

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(signer_key_pair, transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'global mosaic restriction (modify) transaction hash {transaction_hash}')

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='global mosaic restriction (modify) transaction')


async def create_mosaic_atomic_swap(facade, signer_key_pair):
	# derive the signer's address
	signer_address = facade.network.public_key_to_address(signer_key_pair.public_key)
	print(f'creating transaction with signer {signer_address}')

	# get the current network time from the network, and set the transaction deadline two hours in the future
	network_time = await get_network_time()
	network_time = network_time.add_hours(2)

	# create a second signing key pair that will be used as the swap partner
	partner_key_pair = await create_account_with_tokens_from_faucet(facade)

	# Alice (signer) owns some amount of custom mosaic (with divisibility=2)
	# Bob (partner) wants to exchange 20 xem for a single piece of Alice's custom mosaic
	# there will be two transfers within an aggregate
	embedded_transactions = [
		facade.transaction_factory.create_embedded({
			'type': 'transfer_transaction',
			'signer_public_key': partner_key_pair.public_key,

			'recipient_address': facade.network.public_key_to_address(signer_key_pair.public_key),
			'mosaics': [
				{'mosaic_id': generate_mosaic_alias_id('symbol.xym'), 'amount': 20_000000}
			]
		}),

		facade.transaction_factory.create_embedded({
			'type': 'transfer_transaction',
			'signer_public_key': signer_key_pair.public_key,

			'recipient_address': facade.network.public_key_to_address(partner_key_pair.public_key),
			'mosaics': [
				{'mosaic_id': generate_mosaic_id(signer_address, 123), 'amount': 100}
			]
		})
	]

	# Alice will be signer of aggregate itself, that also means he won't have to attach his cosignature
	transaction = facade.transaction_factory.create({
		'signer_public_key': signer_key_pair.public_key,
		'deadline': network_time.timestamp,

		'type': 'aggregate_complete_transaction',
		'transactions_hash': facade.hash_embedded_transactions(embedded_transactions).bytes,
		'transactions': embedded_transactions
	})

	# Bob needs to cosign the transaction because the swap will only be confirmed if both the sender and the partner agree to it

	# set the maximum fee that the signer will pay to confirm the transaction; transactions bidding higher fees are generally prioritized
	transaction.fee = Amount(100 * transaction.size)

	# sign the transaction and attach its signature
	signature = facade.sign_transaction(signer_key_pair, transaction)
	facade.transaction_factory.attach_signature(transaction, signature)

	# hash the transaction (this is dependent on the signature)
	transaction_hash = facade.hash_transaction(transaction)
	print(f'mosaic swap transaction hash {transaction_hash}')

	# cosign transaction by all partners (this is dependent on the hash and consequently the main signature)
	for cosignatory_key_pair in [partner_key_pair]:
		cosignature = Cosignature()
		cosignature.version = 0
		cosignature.signer_public_key = PublicKey(cosignatory_key_pair.public_key.bytes)
		cosignature.signature = Signature(cosignatory_key_pair.sign(transaction_hash.bytes).bytes)
		transaction.cosignatures.append(cosignature)

	# finally, construct the over wire payload
	json_payload = facade.transaction_factory.attach_signature(transaction, signature)

	# print the signed transaction, including its signature
	print(transaction)

	# submit the transaction to the network and wait for it to be confirmed
	async with ClientSession(raise_for_status=True) as session:
		# initiate a HTTP PUT request to a Symbol REST endpoint
		async with session.put(f'{SYMBOL_API_ENDPOINT}/transactions', json=json.loads(json_payload)) as response:
			response_json = await response.json()
			print(response_json)

	await wait_for_confirmed_transaction(transaction_hash, transaction_description='mosaic swap transaction')


# endregion


# region mosaic restrictions transactions

# ...

# endregion


def print_banner(name):
	console_width = shutil.get_terminal_size()[0]
	print('*' * console_width)

	name_padding = ' ' * ((console_width - len(name)) // 2 - 4)
	name_trailing_whitespace = ' ' if 0 == (console_width - len(name)) % 2 else '  '
	print(f'***{name_padding} {name}{name_trailing_whitespace}{name_padding}***')

	print('*' * console_width)


def run_offline_account_creation_examples(facade):  # pylint: disable=invalid-name
	functions = [
		create_random_account,
		create_random_bip32_account
	]
	for func in functions:
		print_banner(func.__qualname__)
		func(facade)


async def run_network_query_examples():
	functions = [
		get_network_time,
		get_maximum_supply,
		get_total_supply,
		get_circulating_supply,
		get_network_height,
		get_network_finalized_height
	]
	for func in functions:
		print_banner(func.__qualname__)
		await func()


async def run_transaction_creation_examples(facade):
	print_banner('CREATING SIGNER ACCOUNT FOR TRANSACTION CREATION EXAMPLES')

	# create a signing key pair that will be used to sign the created transaction(s)
	signer_key_pair = await create_account_with_tokens_from_faucet(facade)

	functions = [
		create_account_metadata_transaction_new,
		create_account_metadata_transaction_modify,

		create_namespace_registration_transaction_root,
		create_namespace_registration_transaction_child,
		create_namespace_metadata_transaction_new,
		create_namespace_metadata_transaction_modify,

		create_mosaic_definition_transaction,
		create_mosaic_supply_transaction,
		create_mosaic_atomic_swap,

		create_global_mosaic_restriction_transaction_new,
		create_address_mosaic_restriction_transaction_1,
		create_address_mosaic_restriction_transaction_2,
		create_address_mosaic_restriction_transaction_3,
		create_global_mosaic_restriction_transaction_modify,

		create_multisig_account_modification_transaction_new_account,
		create_multisig_account_modification_transaction_modify_account
	]
	for func in functions:
		print_banner(func.__qualname__)
		await func(facade, signer_key_pair)


async def main():
	facade = SymbolFacade('testnet')

	run_offline_account_creation_examples(facade)
	await run_network_query_examples()
	await run_transaction_creation_examples(facade)

	print_banner('FIN')


if __name__ == '__main__':
	asyncio.run(main())
