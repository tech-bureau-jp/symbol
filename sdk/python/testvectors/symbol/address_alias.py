SAMPLE_ADDRESS = 'TBA6LOHEA6A465G2X5MSQF66JBYR254GJDPK7MQ'
SCHEMA_NAME = 'AddressAliasTransaction'

transactions = [  # pylint: disable=duplicate-code
	{
		'schema_name': SCHEMA_NAME,
		'descriptor': {
			'type': 'address_alias_transaction',
			'namespace_id': 0x84B3552D375FFA4B,
			'address': SAMPLE_ADDRESS,
			'alias_action': 'link'
		}
	},
	{
		'schema_name': SCHEMA_NAME,
		'descriptor': {
			'type': 'address_alias_transaction',
			'namespace_id': 0x84B3552D375FFA4B,
			'address': SAMPLE_ADDRESS,
			'alias_action': 'unlink'
		}
	}
]
