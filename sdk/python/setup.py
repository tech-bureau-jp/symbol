# -*- coding: utf-8 -*-
from setuptools import setup

packages = \
['symbolchain',
   'symbolchain.facade',
   'symbolchain.nc',
   'symbolchain.nem',
   'symbolchain.external',
   'symbolchain.sc',
   'symbolchain.symbol']

package_data = \
{'': ['*']}

install_requires = \
['cryptography==40.0.2',
    'mnemonic==0.20',
    'Pillow==9.5.0',
    'pynacl==1.5.0',
    'safe-pysha3==1.0.3',
    'PyYAML==6.0',
    'pyzbar==0.1.9',
    'ripemd-hash==1.0.0',
    'qrcode==7.4.2']

setup_kwargs = {
    'name': 'techbureau-symbol-sdk-python',
    'version': '3.0.7.dev1',
    'description': 'Symbol SDK',
    'long_description': 'This is symbol project core sdk python library.',
    'author': 'Techbureau Contributors',
    'author_email': 'development@techbureau.jp',
    'maintainer': 'Techbureau Contributors',
    'maintainer_email': 'development@techbureau.jp',
    'url': 'https://github.com/tech-bureau-jp/symbol/tree/dev/sdk/python',
    'packages': packages,
    'package_data': package_data,
    'install_requires': install_requires,
    'python_requires': '>=3.7,<4.0',
}

setup(**setup_kwargs)
