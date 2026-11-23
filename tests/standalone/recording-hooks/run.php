<?php
declare(strict_types=1);
/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCP\EventDispatcher { class Event { public function __construct() {} } interface IEventDispatcher {} }
namespace OCP\Files { interface File {} interface IRootFolder {} }
namespace OCP { interface IConfig {} interface IUserManager {} }
namespace OCP\L10N { interface IFactory {} }
namespace OCP\SystemTag { interface ISystemTagObjectMapper {} }
namespace OCP\AppFramework\Services { interface IAppConfig {} }
namespace OCP\TaskProcessing { interface IManager {} class Task { public function __construct(public $type, public $input, public $app, public $owner, public $custom) {} } }
namespace OCP\TaskProcessing\TaskTypes { class AudioToText { const ID='audio'; } class TextToText { const ID='text'; } }
namespace Psr\Log { interface LoggerInterface {} }
namespace OCA\Talk\AppInfo { class Application { const APP_ID='spreed'; } }
namespace OCA\Talk { class Config { const CALL_RECORDING_SUMMARY_PROMPT='prompt'; } class Room { function getToken(){return 'room1234';} } class Participant {} class Manager { function getRoomForUserByToken($a,$b){return new Room();} } }
namespace OCA\Talk\Service { class ParticipantService { function getParticipant($a,$b){return new \OCA\Talk\Participant();} } }
namespace Harness {
require __DIR__.'/../../../lib/Events/BeforeRecordingTranscriptionScheduledEvent.php';
require __DIR__.'/../../../lib/Events/BeforeRecordingTranscriptSavedEvent.php';
require __DIR__.'/../../../lib/Service/RecordingService.php';
class S extends \OCA\Talk\Service\RecordingService { public function notifyStoredRecording(\OCA\Talk\Room $r, \OCA\Talk\Participant $p, \OCP\Files\File $f): void {} public function notifyStoredTranscript(\OCA\Talk\Room $r, \OCA\Talk\Participant $p, \OCP\Files\File $f, string $a): void {} }
class RFile implements \OCP\Files\File { function __construct(public $parent=null){} function getId(){return 42;} function getName(){return 'rec.ogg';} function getParent(){return $this->parent;} }
class Folder { public $saved; public $files=[]; function getName(){return 'room1234';} function getById($id){return [new RFile($this)];} function newFile($name,$content){$this->saved=$content; $this->files[$name]=$content; return new RFile();} }
class Root implements \OCP\Files\IRootFolder { function __construct(public $folder){} function getUserFolder($o){return $this->folder;} }
class Conf implements \OCP\IConfig { function getAppValue($a,$k,$d){return 'yes';} }
class AppConf implements \OCP\AppFramework\Services\IAppConfig { function getAppValueString($x){return 'prompt';} }
class U implements \OCP\IUserManager { function get($x){return null;} }
class L implements \OCP\L10N\IFactory { function getUserLanguage($u){return 'en';} function get($a,$l){return new class { function t($s){return 'warning';} };} }
class Tags implements \OCP\SystemTag\ISystemTagObjectMapper { function assignGeneratedByAITag($id,$x){} }
class Logger implements \Psr\Log\LoggerInterface { function __call($a,$b){} }
class M implements \OCP\TaskProcessing\IManager { public $task; function __construct(public $available){} function getAvailableTaskTypeIds(){return $this->available;} function scheduleTask($t){$this->task=$t;} }
class D implements \OCP\EventDispatcher\IEventDispatcher { function __construct(public $f){} function dispatchTyped($e){($this->f)($e);} }
function put($s,$name,$v){$p=new \ReflectionProperty(\OCA\Talk\Service\RecordingService::class,$name);$p->setValue($s,$v);}
function service($dispatch,$available=['audio','custom','text']) { $s=(new \ReflectionClass(S::class))->newInstanceWithoutConstructor(); put($s,'serverConfig',new Conf()); put($s,'taskProcessingManager',new M($available)); put($s,'eventDispatcher',new D($dispatch)); put($s,'logger',new Logger()); return $s; }
function check($v,$message){if(!$v)throw new \Exception($message);}
function task($s){$p=new \ReflectionProperty(\OCA\Talk\Service\RecordingService::class,'taskProcessingManager');return $p->getValue($s)->task;}
function schedule($s){$m=new \ReflectionMethod(\OCA\Talk\Service\RecordingService::class,'finalizeRecording');$m->invoke($s,new \OCA\Talk\Room(),new \OCA\Talk\Participant(),new RFile(),'owner');}
foreach (['default','chosen','unsupported','throw'] as $case) {
 $s=service(function($e)use($case){if($case!=='default'){$e->select($case==='unsupported'?'missing':'custom','job_123');} if($case==='throw')throw new \Exception();}); schedule($s); $t=task($s); check($t->type===($case==='chosen'?'custom':'audio'),$case.' type'); check($t->input===($case==='chosen'?['input'=>42,'job'=>'job_123']:['input'=>42]),$case.' input');
}
foreach (['named','throw'] as $case) {
 $folder=new Folder(); $s=service(function($e)use($case){$e->setFileContent('named');if($case==='throw')throw new \Exception();});
 put($s,'rootFolder',new Root($folder));put($s,'roomManager',new \OCA\Talk\Manager());put($s,'participantService',new \OCA\Talk\Service\ParticipantService());put($s,'userManager',new U());put($s,'l10nFactory',new L());put($s,'systemTagMapper',new Tags());put($s,'appConfig',new AppConf());
 $s->storeTranscript('owner','room1234',42,'plain','transcript','custom','job_123');
 check(str_starts_with($folder->saved,$case==='named'?'named':'plain'),$case.' file'); check(task($s)->input===['input'=>"prompt\nplain"],$case.' summary');
}
foreach (['scoped-no-receipt','scoped-throw','scoped-chosen','scoped-chosen-throw'] as $case) {
 $s=service(function($e)use($case){$e->requireLocalOnly();if($case==='scoped-throw')throw new \Exception();if($case==='scoped-chosen' || $case==='scoped-chosen-throw')$e->select('custom','job_123');if($case==='scoped-chosen-throw')throw new \Exception();});
 schedule($s);$t=task($s);
 if($case==='scoped-chosen' || $case==='scoped-chosen-throw')check($t->input===['input'=>42,'job'=>'job_123','summary_policy'=>'local-only'],'scoped input');
 else check($t===null,$case.' must not fall back to external');
}
foreach (['local-ok','local-missing','local-throw','plain-only'] as $case) {
 $folder=new Folder();$s=service(function($e)use($case){check($e->localOnly,'local flag');if($case!=='plain-only')$e->setFileContent('named');if($case==='local-ok')$e->setLocalSummary('private summary');if($case==='local-throw')throw new \Exception();});
 put($s,'rootFolder',new Root($folder));put($s,'roomManager',new \OCA\Talk\Manager());put($s,'participantService',new \OCA\Talk\Service\ParticipantService());put($s,'userManager',new U());put($s,'l10nFactory',new L());put($s,'systemTagMapper',new Tags());put($s,'appConfig',new AppConf());
 $s->storeTranscript('owner','room1234',42,'plain','transcript','custom','job_123','local-only');
 check(task($s)===null,$case.' must not schedule TextToText');
 check(isset($folder->files['rec - summary.md'])===($case==='local-ok'),$case.' local summary');
 if($case==='local-ok')check(str_starts_with($folder->files['rec - summary.md'],"<!-- k4-talk-local-only: v1 -->\nprivate summary"),'summary contents');
 if($case==='local-throw' || $case==='plain-only')check(str_starts_with($folder->files['rec.md'],"<!-- k4-talk-local-only: v1 -->\nplain"),'plain fallback');
}
echo "PASS: default/custom/unsupported/throw selection; named file and unchanged plain summary; failed listener fallback; scoped local-only privacy and summary\n";
}
