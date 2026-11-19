<?php

declare(strict_types=1);
/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\Tests\php\Service;

use OCA\Talk\BackgroundJob\EndEmptyCall;
use OCA\Talk\Config;
use OCA\Talk\Manager;
use OCA\Talk\Room;
use OCA\Talk\Service\EmojiService;
use OCA\Talk\Service\ParticipantService;
use OCA\Talk\Service\RoomService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Calendar\IManager as ICalendarManager;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\IDBConnection;
use OCP\IL10N;
use OCP\ISession;
use OCP\IUserManager;
use OCP\Security\IHasher;
use OCP\Share\IManager as IShareManager;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\MockObject\MockObject;
use Psr\Log\LoggerInterface;
use Test\TestCase;

/**
 * NAS_CLOUD#201: endEmptyCallBeforeJoin общий для REST, HPB/SIP и федеративного входа.
 */
#[Group('DB')]
class RoomServiceEmptyCallTest extends TestCase {
	private ParticipantService&MockObject $participantService;

	private function service(): RoomService&MockObject {
		$time = $this->createMock(ITimeFactory::class);
		$time->method('getTime')->willReturn(1000);
		$this->participantService = $this->createMock(ParticipantService::class);
		return $this->getMockBuilder(RoomService::class)
			->setConstructorArgs([
				$this->createMock(Manager::class),
				$this->participantService,
				$this->createMock(IDBConnection::class),
				$time,
				$this->createMock(IShareManager::class),
				$this->createMock(Config::class),
				$this->createMock(IHasher::class),
				$this->createMock(IEventDispatcher::class),
				$this->createMock(EmojiService::class),
				$this->createMock(LoggerInterface::class),
				$this->createMock(IL10N::class),
				$this->createMock(ICalendarManager::class),
				$this->createMock(IUserManager::class),
				$this->createMock(ISession::class),
			])
			->onlyMethods(['resetActiveSince'])
			->getMock();
	}

	public function testReturnBeforeGraceKeepsCall(): void {
		$service = $this->service();
		$this->participantService->method('getEmptyCallSince')->willReturn(1000 - EndEmptyCall::GRACE + 10);
		$service->expects($this->never())->method('resetActiveSince');
		$service->endEmptyCallBeforeJoin($this->createMock(Room::class));
	}

	public function testReturnAfterGraceEndsOldCallAtEmptyMoment(): void {
		$service = $this->service();
		$emptySince = 1000 - EndEmptyCall::GRACE - 5;
		$this->participantService->method('getEmptyCallSince')->willReturn($emptySince);
		$this->participantService->method('hasActiveSessionsInCall')->willReturn(false);
		$room = $this->createMock(Room::class);
		$service->expects($this->once())->method('resetActiveSince')->with($room, null, $emptySince);
		$service->endEmptyCallBeforeJoin($room);
	}

	public function testActiveSessionKeepsCallEvenAfterGrace(): void {
		$service = $this->service();
		$this->participantService->method('getEmptyCallSince')->willReturn(1);
		$this->participantService->method('hasActiveSessionsInCall')->willReturn(true);
		$service->expects($this->never())->method('resetActiveSince');
		$service->endEmptyCallBeforeJoin($this->createMock(Room::class));
	}

	public function testNoMarkNoAction(): void {
		$service = $this->service();
		$this->participantService->method('getEmptyCallSince')->willReturn(0);
		$service->expects($this->never())->method('resetActiveSince');
		$service->endEmptyCallBeforeJoin($this->createMock(Room::class));
	}
}
