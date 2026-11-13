<?php

declare(strict_types=1);
/**
 * SPDX-FileCopyrightText: 2018 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\BackgroundJob;

use OCA\Talk\Federation\FederationManager;
use OCA\Talk\Manager;
use OCA\Talk\Participant;
use OCA\Talk\Room;
use OCA\Talk\Service\ParticipantService;
use OCA\Talk\Service\RoomService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJob;
use OCP\BackgroundJob\TimedJob;
use OCP\Files\Config\IUserMountCache;
use Psr\Log\LoggerInterface;

/**
 * Class RemoveEmptyRooms
 *
 * @package OCA\Talk\BackgroundJob
 */
class RemoveEmptyRooms extends TimedJob {

	protected int $numDeletedRooms = 0;

	public function __construct(
		ITimeFactory $time,
		private readonly Manager $manager,
		private readonly RoomService $roomService,
		private readonly ParticipantService $participantService,
		private readonly FederationManager $federationManager,
		private readonly LoggerInterface $logger,
		private readonly IUserMountCache $userMountCache,
	) {
		parent::__construct($time);

		// Every 5 minutes
		$this->setInterval(60 * 5);
		$this->setTimeSensitivity(IJob::TIME_INSENSITIVE);

	}

	#[\Override]
	protected function run($argument): void {
		$this->manager->forAllRooms($this->callback(...));

		if ($this->numDeletedRooms) {
			$this->logger->info('Deleted {numDeletedRooms} rooms because they were empty', [
				'numDeletedRooms' => $this->numDeletedRooms,
			]);
		}
	}

	public function callback(Room $room): void {
		if ($room->getType() === Room::TYPE_CHANGELOG) {
			return;
		}

		if ($this->deleteIfIsEmpty($room)) {
			return;
		}

		if ($this->deleteIfFileIsRemoved($room)) {
			return;
		}

		$this->endCallIfNobodyLeft($room);
	}

	/**
	 * ket4tec (NAS_CLOUD#129): страховка для звонка, который никто не закроет: задача EndEmptyCall потерялась
	 * (cron удаляет задачу, если класса нет — магазин приложений затёр форк), сессии ушли без выхода (backend
	 * в режиме обслуживания отвечал 503) или удалены чисткой без сброса звонка. Раз в 5 минут каждый идущий
	 * звонок проходит тот же путь, что и выход последнего: живые сессии в звонке — ничего; иначе отметка
	 * опустения (старая сохраняется) и EndEmptyCall через GRACE.
	 */
	private function endCallIfNobodyLeft(Room $room): void {
		// федеративный звонок ведёт сервер-хозяин, локальные сессии его не описывают
		if ($room->getCallFlag() === Participant::FLAG_DISCONNECTED || $room->isFederatedConversation()) {
			return;
		}

		$this->participantService->resetCallStateWhenNeeded($room);
	}

	private function deleteIfIsEmpty(Room $room): bool {
		if ($room->getObjectType() === 'file') {
			return false;
		}

		if ($this->participantService->getNumberOfActors($room) !== 0) {
			return false;
		}

		if ($room->isFederatedConversation()
			&& $this->federationManager->getNumberOfInvitations($room) !== 0) {
			return false;
		}

		$this->doDeleteRoom($room);
		return true;
	}

	private function deleteIfFileIsRemoved(Room $room): bool {
		if ($room->getObjectType() !== 'file') {
			return false;
		}

		$mountsForFile = $this->userMountCache->getMountsForFileId((int)$room->getObjectId());
		if (!empty($mountsForFile)) {
			return false;
		}

		$this->doDeleteRoom($room);
		return true;
	}

	private function doDeleteRoom(Room $room): void {
		$this->roomService->deleteRoom($room);
		$this->numDeletedRooms++;
	}
}
