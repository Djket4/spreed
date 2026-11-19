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
use OCP\DB\QueryBuilder\IExpressionBuilder;
use OCP\DB\QueryBuilder\IQueryBuilder;
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
			->setConstructorArgs($this->ctorArgs($this->createMock(IDBConnection::class), $time))
			->onlyMethods(['resetActiveSince'])
			->getMock();
	}

	private function ctorArgs(IDBConnection $db, ?ITimeFactory $time = null): array {
		$time ??= $this->createMock(ITimeFactory::class);
		$this->participantService ??= $this->createMock(ParticipantService::class);
		return [
				$this->createMock(Manager::class),
				$this->participantService,
				$db,
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
		];
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
		$activeSince = new \DateTime('@500');
		$room = $this->createMock(Room::class);
		$room->method('getActiveSince')->willReturn($activeSince);
		$service->expects($this->once())->method('resetActiveSince')->with($room, null, $emptySince, $activeSince);
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

	public function testResetInDatabaseOnlyFiltersByExpectedActiveSince(): void {
		$expr = $this->createMock(IExpressionBuilder::class);
		$expr->method('eq')->willReturnCallback(fn ($f) => 'eq:' . $f);
		$expr->method('isNotNull')->willReturn('notnull');
		$qb = $this->createMock(IQueryBuilder::class);
		$qb->method('expr')->willReturn($expr);
		$qb->method('update')->willReturnSelf();
		$qb->method('set')->willReturnSelf();
		$qb->method('where')->willReturnSelf();
		$qb->method('createNamedParameter')->willReturn('p');
		$qb->method('executeStatement')->willReturn(1);
		$wheres = [];
		$qb->method('andWhere')->willReturnCallback(function ($w) use (&$wheres, $qb) {
			$wheres[] = $w;
			return $qb;
		});
		$db = $this->createMock(IDBConnection::class);
		$db->method('getQueryBuilder')->willReturn($qb);
		$service = new RoomService(...$this->ctorArgs($db));
		$room = $this->createMock(Room::class);

		$service->resetActiveSinceInDatabaseOnly($room);
		$this->assertSame(['notnull'], $wheres);

		$wheres = [];
		$service->resetActiveSinceInDatabaseOnly($room, new \DateTime('@500'));
		$this->assertSame(['notnull', 'eq:active_since'], $wheres);
	}
}
