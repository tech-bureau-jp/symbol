/**
*** Copyright (c) 2016-present,
*** Jaguar0625, gimre, BloodyRookie, Tech Bureau, Corp. All rights reserved.
***
*** This file is part of Catapult.
***
*** Catapult is free software: you can redistribute it and/or modify
*** it under the terms of the GNU Lesser General Public License as published by
*** the Free Software Foundation, either version 3 of the License, or
*** (at your option) any later version.
***
*** Catapult is distributed in the hope that it will be useful,
*** but WITHOUT ANY WARRANTY; without even the implied warranty of
*** MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
*** GNU Lesser General Public License for more details.
***
*** You should have received a copy of the GNU Lesser General Public License
*** along with Catapult. If not, see <http://www.gnu.org/licenses/>.
**/

#include "ProofStorageCache.h"

namespace catapult { namespace io {

	// region ProofStorageView

	ProofStorageView::ProofStorageView(const ProofStorage& storage, utils::SpinReaderWriterLock::ReaderLockGuard&& readLock)
			: m_storage(storage)
			, m_readLock(std::move(readLock))
	{}

	FinalizationPoint ProofStorageView::finalizationPoint() const {
		return m_storage.finalizationPoint();
	}

	Height ProofStorageView::finalizedHeight() const {
		return m_storage.finalizedHeight();
	}

	model::FinalizationStatistics ProofStorageView::statistics() const {
		return m_storage.statistics();
	}

	model::HeightHashPairRange ProofStorageView::loadFinalizedHashesFrom(FinalizationPoint point, size_t maxHashes) const {
		return m_storage.loadFinalizedHashesFrom(point, maxHashes);
	}

	std::shared_ptr<const model::PackedFinalizationProof> ProofStorageView::loadProof(FinalizationPoint point) const {
		return m_storage.loadProof(point);
	}

	std::shared_ptr<const model::PackedFinalizationProof> ProofStorageView::loadProof(Height height) const {
		return m_storage.loadProof(height);
	}

	// endregion

	// region ProofStorageModifier

	ProofStorageModifier::ProofStorageModifier(ProofStorage& storage, utils::SpinReaderWriterLock::WriterLockGuard&& writeLock)
			: m_storage(storage)
			, m_writeLock(std::move(writeLock))
	{}

	void ProofStorageModifier::saveProof(Height height, const FinalizationProof& proof) {
		m_storage.saveProof(height, proof);
	}

	// endregion

	// region ProofStorageCache

	ProofStorageCache::ProofStorageCache(std::unique_ptr<ProofStorage>&& pStorage) : m_pStorage(std::move(pStorage))
	{}

	ProofStorageCache::~ProofStorageCache() = default;

	ProofStorageView ProofStorageCache::view() const {
		auto readLock = m_lock.acquireReader();
		return ProofStorageView(*m_pStorage, std::move(readLock));
	}

	ProofStorageModifier ProofStorageCache::modifier() {
		auto writeLock = m_lock.acquireWriter();
		return ProofStorageModifier(*m_pStorage, std::move(writeLock));
	}

	// endregion
}}
