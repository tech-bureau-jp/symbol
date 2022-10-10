from symbolchain import sc

from ..ByteArray import ByteArray
from ..CryptoTypes import Hash256, PublicKey
from ..RuleBasedTransactionFactory import RuleBasedTransactionFactory
from .Network import Address


class ProofVerificationHash(ByteArray):
	"""Represents a 128-bit proof verification hash."""

	SIZE = 16

	def __init__(self, proof_verification_hash):
		"""Creates a proof verification hash from bytes or a hex string."""
		super().__init__(self.SIZE, proof_verification_hash, ProofVerificationHash)

	def __repr__(self):
		return f'ProofVerificationHash(\'{str(self)}\')'


class BlockFactory:
	"""Factory for creating Symbol blocks."""

	def __init__(self, network, type_rule_overrides=None):
		"""Creates a factory for the specified network."""
		self.factory = self._build_rules(type_rule_overrides)
		self.network = network

	def _create_and_extend(self, block_descriptor, autosort, factory_class):
		block = self.factory.create_from_factory(factory_class.create_by_name, {
			**block_descriptor,
			'network': self.network.identifier
		})
		if autosort:
			block.sort()

		return block

	def create(self, block_descriptor, autosort=True):
		"""
		Creates a block from a block descriptor.
		When autosort is set (default), descriptor arrays requiring ordering will be automatically sorted.
		When unset, descriptor arrays will be presumed to be already sorted.
		"""
		return self._create_and_extend(block_descriptor, autosort, sc.BlockFactory)

	@staticmethod
	def _symbol_type_converter(value):
		if isinstance(value, Address):
			return sc.UnresolvedAddress(value.bytes)

		return None

	@staticmethod
	def _build_rules(type_rule_overrides):
		factory = RuleBasedTransactionFactory(sc, BlockFactory._symbol_type_converter, type_rule_overrides)
		factory.autodetect()

		factory.add_struct_parser('VrfProof')

		sdk_type_block_mapping = {
			'UnresolvedAddress': Address,
			'Address': Address,
			'Hash256': Hash256,
			'PublicKey': PublicKey,
			'ProofGamma': Hash256,  # should introduce type?
			'ProofVerificationHash': ProofVerificationHash,
			'ProofScalar': Hash256  # should introduce type?
		}
		for name, typename in sdk_type_block_mapping.items():
			factory.add_pod_parser(name, typename)

		for name in ['BlockType', 'UnresolvedAddress']:
			factory.add_array_parser(name)

		return factory
