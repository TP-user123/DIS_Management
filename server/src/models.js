import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const base = { companyId: { type: Schema.Types.ObjectId, required: true, index: true } };
const companySchema = new Schema({ name: { type: String, required: true, trim: true, default: 'TCS' }, slug: { type: String, required: true, unique: true, lowercase: true, default: 'tcs' }, status: { type: String, enum: ['active','suspended'], default: 'active' }, rolePermissions: { type: Schema.Types.Mixed, default: null }, createdAt: { type: Date, default: Date.now } });
const userSchema = new Schema({ ...base, name: { type: String, required: true, trim: true }, email: { type: String, required: true, lowercase: true, trim: true }, passwordHash: { type: String, required: true }, role: { type: String, enum: ['MANAGER','TL','SL','RE'], default: 'RE' }, team: { type: String, default: 'IT Support' }, shift: { type: String, default: 'General' }, status: { type: String, enum: ['active','inactive'], default: 'active' }, tempPasswordChangeRequired: { type: Boolean, default: false }, resetTokenHash: { type: String, default: null }, resetTokenExpiresAt: { type: Date, default: null }, lastLoginAt: { type: Date, default: null } }, { timestamps: true });
userSchema.index({ companyId: 1, email: 1 }, { unique: true });
const caseSchema = new Schema({ ...base, caseNumber: { type: String, required: true }, type: { type: String, enum: ['INCIDENT','SERVICE_REQUEST','GENERAL_TASK'], default: 'INCIDENT' }, title: { type: String, required: true, trim: true }, description: { type: String, default: '' }, priority: { type: String, enum: ['CRITICAL','HIGH','MEDIUM','LOW'], default: 'MEDIUM' }, status: { type: String, enum: ['OPEN','IN_PROGRESS','PENDING','RESOLVED','CLOSED'], default: 'OPEN' }, createdBy: { type: Schema.Types.ObjectId, required: true }, ownerId: { type: Schema.Types.ObjectId, default: null }, team: { type: String, default: 'IT Support' }, dueAt: { type: Date, default: null }, resolvedAt: { type: Date, default: null }, closedAt: { type: Date, default: null } }, { timestamps: true });
caseSchema.index({ companyId: 1, caseNumber: 1 }, { unique: true });
const taskScheduleHistorySchema = new Schema({ action: { type: String, enum: ['POSTPONED','DONE','CANCELLED'], required: true }, fromDate: { type: Date, required: true }, toDate: { type: Date, default: null }, performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }, performedAt: { type: Date, default: Date.now } }, { _id: false });
const taskScheduleDateSchema = new Schema({ date: { type: Date, required: true }, status: { type: String, enum: ['PENDING','DONE','CANCELLED'], default: 'PENDING' }, completedAt: { type: Date, default: null }, cancelledAt: { type: Date, default: null }, actionBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }, history: { type: [taskScheduleHistorySchema], default: [] } });
const taskSchema = new Schema({ ...base, caseId: { type: Schema.Types.ObjectId, ref: 'Case', default: null, index: true }, taskNumber: { type: String, required: true }, title: { type: String, required: true, trim: true }, description: { type: String, default: '' }, category: { type: String, enum: ['OPERATIONAL','INCIDENT_FOLLOWUP','GENERAL'], default: 'OPERATIONAL' }, priority: { type: String, enum: ['CRITICAL','HIGH','MEDIUM','LOW'], default: 'MEDIUM' }, status: { type: String, enum: ['OPEN','ASSIGNED','WIP','PENDING','COMPLETED'], default: 'OPEN' }, createdBy: { type: Schema.Types.ObjectId, required: true }, assignedBy: { type: Schema.Types.ObjectId, default: null }, assigneeId: { type: Schema.Types.ObjectId, default: null }, team: { type: String, default: 'IT Support' }, location: { type: String, default: '' }, frequency: { type: String, enum: ['ONE_TIME','DAILY','WEEKLY','QUARTERLY'], default: 'ONE_TIME' }, scheduleDates: { type: [taskScheduleDateSchema], default: [] }, dueAt: { type: Date, default: null }, completedAt: { type: Date, default: null } }, { timestamps: true });
taskSchema.index({ companyId: 1, assigneeId: 1, status: 1 });
taskSchema.index({ companyId: 1, assigneeId: 1, updatedAt: -1 });
taskSchema.index({ companyId: 1, updatedAt: -1 });
const handoverSchema = new Schema({ ...base, caseId: { type: Schema.Types.ObjectId, ref: 'Case', default: null }, taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null }, assetId: { type: Schema.Types.ObjectId, ref: 'Asset', default: null }, fromUserId: { type: Schema.Types.ObjectId, required: true }, toUserId: { type: Schema.Types.ObjectId, default: null }, targetUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }], acceptedBy: { type: Schema.Types.ObjectId, default: null, ref: 'User' }, initiatedBy: { type: Schema.Types.ObjectId, required: true }, reason: { type: String, default: '' }, notes: { type: String, default: '' }, status: { type: String, enum: ['PENDING','ACCEPTING','ACCEPTED','REJECTED'], default: 'PENDING' }, acceptedAt: { type: Date, default: null } }, { timestamps: true });
handoverSchema.index({ companyId: 1, assetId: 1, status: 1, createdAt: -1 });
handoverSchema.path('fromUserId').options.ref = 'User';
handoverSchema.path('toUserId').options.ref = 'User';
const activitySchema = new Schema({ ...base, entityType: { type: String, enum: ['CASE','TASK','HANDOVER','TICKET','EVENT','ISSUE'], required: true }, entityId: { type: Schema.Types.ObjectId, required: true }, action: { type: String, required: true }, performedBy: { type: Schema.Types.ObjectId, required: true }, details: { type: Schema.Types.Mixed, default: {} }, comment: { type: String, default: '' } }, { timestamps: true });
const ticketSchema = new Schema({ ...base, ticketNumber: { type: String, required: true }, sourceStatus: { type: String, default: 'Open' }, workflowStatus: { type: String, enum: ['OPEN','WIP','ROUTED','RESOLVED','REOPENED'], default: 'OPEN', index: true }, routedToLevel: { type: String, default: '' }, routingNotes: { type: String, default: '' }, createdBy: { type: Schema.Types.ObjectId, default: null }, statusUpdatedBy: { type: Schema.Types.ObjectId, default: null }, statusUpdatedAt: { type: Date, default: null }, statusRemarks: { type: String, default: '' }, solutionProvider: { type: String, default: '' }, currentLevel: { type: String, default: '' }, loggedDate: { type: Date, default: Date.now }, item: { type: String, default: '' }, requestType: { type: String, default: '' }, priorityName: { type: String, default: 'Medium' }, description: { type: String, default: '' }, remarks: { type: String, default: '' }, assigneeId: { type: Schema.Types.ObjectId, default: null }, assignedBy: { type: Schema.Types.ObjectId, default: null }, assignmentUpdatedAt: { type: Date, default: null }, lastImportedAt: { type: Date, default: Date.now }, sourceRow: { type: Schema.Types.Mixed, default: {} } }, { timestamps: true });
ticketSchema.add({
  resolvedAt: { type: Date, default: null },
  reopenedAt: { type: Date, default: null },
  ageStartedAt: { type: Date, default: null },
  statusBeforeResolution: { type: String, enum: ['OPEN', 'WIP', 'REOPENED', 'ROUTED'], default: null }
});
ticketSchema.index({ companyId: 1, ticketNumber: 1 }, { unique: true });
ticketSchema.index({ companyId: 1, assigneeId: 1 });
const notificationSchema = new Schema({ ...base, userId: { type: Schema.Types.ObjectId, required: true, index: true }, type: { type: String, default: 'INFO' }, title: { type: String, required: true }, message: { type: String, default: '' }, link: { type: String, default: '' }, readAt: { type: Date, default: null }, dismissedAt: { type: Date, default: null }, dedupeKey: { type: String, default: '' } }, { timestamps: true });
notificationSchema.index({ companyId: 1, userId: 1, dedupeKey: 1 }, { unique: true, sparse: true });
const eventOccurrenceUpdateSchema = new Schema({ userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' }, dateKey: { type: String, required: true }, status: { type: String, enum: ['PENDING','DONE','CANCELLED','POSTPONED'], default: 'PENDING' }, postponedTo: { type: String, default: '' }, additional: { type: Boolean, default: false }, updatedAt: { type: Date, default: Date.now } }, { _id: false });
const eventSchema = new Schema({ ...base, title: { type: String, required: true }, description: { type: String, default: '' }, startsAt: { type: Date, required: true }, endsAt: { type: Date, default: null }, occurrenceDates: { type: [String], default: [] }, occurrenceUpdates: { type: [eventOccurrenceUpdateSchema], default: [] }, location: { type: String, default: '' }, audience: { type: String, enum: ['TEAM','USER'], default: 'TEAM' }, team: { type: String, default: 'IT Support' }, assignedUserIds: [{ type: Schema.Types.ObjectId }], completedByIds: [{ type: Schema.Types.ObjectId, ref: 'User' }], createdBy: { type: Schema.Types.ObjectId, required: true } }, { timestamps: true });
const workReportSchema = new Schema({ ...base, userId: { type: Schema.Types.ObjectId, required: true }, title: { type: String, required: true }, summary: { type: String, default: '' }, completedWork: { type: String, default: '' }, blockers: { type: String, default: '' }, ticketRefs: { type: String, default: '' }, status: { type: String, enum: ['SUBMITTED','REVIEWED'], default: 'SUBMITTED' }, reviewedBy: { type: Schema.Types.ObjectId, default: null }, reviewedAt: { type: Date, default: null } }, { timestamps: true });
const engineerIssueSchema = new Schema({ ...base, engineerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' }, tlId: { type: Schema.Types.ObjectId, default: null, ref: 'User' }, team: { type: String, default: 'IT Support' }, title: { type: String, required: true, trim: true }, category: { type: String, enum: ['TECHNICAL_BLOCKER','TOOLING_ACCESS','WORKLOAD_SHIFT','PROCESS','OTHER'], default: 'TECHNICAL_BLOCKER' }, priority: { type: String, enum: ['CRITICAL','HIGH','MEDIUM','LOW'], default: 'MEDIUM' }, description: { type: String, required: true }, status: { type: String, enum: ['OPEN','IN_REVIEW','RESOLVED'], default: 'OPEN' }, tlNotes: { type: String, default: '' }, resolvedAt: { type: Date, default: null }, resolvedBy: { type: Schema.Types.ObjectId, default: null, ref: 'User' } }, { timestamps: true });
engineerIssueSchema.index({ companyId: 1, engineerId: 1 });
engineerIssueSchema.index({ companyId: 1, tlId: 1 });
const repeatedAssetIssueSchema = new Schema({
  issue: { type: String, trim: true, required: true },
  count: { type: Number, default: 0 },
  status: { type: String, enum: ['OPEN', 'RESOLVED'], default: 'OPEN' },
  firstReportedAt: { type: Date, default: Date.now },
  lastReportedAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null }
}, { _id: false });
const assetIssueCycleSchema = new Schema({
  issueNumber: { type: Number, required: true },
  issue: { type: String, trim: true, required: true },
  status: { type: String, enum: ['RECEIVED', 'IN_PROGRESS', 'RESOLVED'], default: 'RECEIVED' },
  reportedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  assignedToId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  assignedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  reportedAt: { type: Date, default: Date.now },
  resolvedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt: { type: Date, default: null },
  resolutionComment: { type: String, trim: true, default: '' }
}, { _id: false });
const assetSchema = new Schema({
  ...base,
  assetId: { type: String, required: true, trim: true },
  assetKey: { type: String, required: true, trim: true },
  userName: { type: String, trim: true, default: '' },
  employeeId: { type: String, trim: true, default: '' },
  project: { type: String, trim: true, default: '' },
  issue: { type: String, trim: true, default: '' },
  systemType: { type: String, enum: ['', 'SOE', 'MTC 22', 'MTC 21', '440', '445'], default: '' },
  status: { type: String, enum: ['RECEIVED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'RETURNED'], default: 'RECEIVED' },
  isArchived: { type: Boolean, default: false },
  archivedAt: { type: Date, default: null },
  archivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  assignedToId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  pendingHandoverId: { type: Schema.Types.ObjectId, ref: 'Handover', default: null },
  eventId: { type: Schema.Types.ObjectId, ref: 'AssetWorkEvent', default: null },
  expectedPickupAt: { type: Date, default: null },
  lastUpdatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  returnedAt: { type: Date, default: null },
  lastCompletedAt: { type: Date, default: null },
  lastCompletedIssue: { type: String, trim: true, default: '' },
  issueSequence: { type: Number, default: 0 },
  currentIssueNumber: { type: Number, default: null },
  currentIssueResolvedById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  currentIssueResolvedAt: { type: Date, default: null },
  issueHistory: { type: [assetIssueCycleSchema], default: [] },
  repeatIssueCount: { type: Number, default: 0 },
  repeatIssues: { type: [repeatedAssetIssueSchema], default: [] }
}, { timestamps: true });
assetSchema.index({ companyId: 1, assetKey: 1 }, { unique: true });
assetSchema.index({ companyId: 1, status: 1, updatedAt: -1 });
assetSchema.index({ companyId: 1, updatedAt: -1 });
assetSchema.index({ companyId: 1, assignedToId: 1, status: 1 });
assetSchema.index({ companyId: 1, currentIssueResolvedById: 1 });
assetSchema.index({ companyId: 1, 'issueHistory.assignedToId': 1 });
assetSchema.index({ companyId: 1, 'issueHistory.resolvedById': 1 });
const assetWorkEventSchema = new Schema({
  ...base,
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  scheduledAt: { type: Date, default: null },
  assetCount: { type: Number, default: 0 },
  assignedUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  isArchived: { type: Boolean, default: false },
  archivedAt: { type: Date, default: null },
  archivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });
assetWorkEventSchema.index({ companyId: 1, assignedUserIds: 1, scheduledAt: 1 });
const assetHistorySchema = new Schema({
  ...base,
  assetId: { type: Schema.Types.ObjectId, ref: 'Asset', required: true },
  action: { type: String, required: true },
  performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  eventId: { type: Schema.Types.ObjectId, ref: 'AssetWorkEvent', default: null },
  changes: { type: Schema.Types.Mixed, default: {} },
  comment: { type: String, default: '' }
}, { timestamps: true });
assetHistorySchema.index({ companyId: 1, assetId: 1, createdAt: -1 });
assetHistorySchema.index({ companyId: 1, assetId: 1, action: 1 });
assetHistorySchema.index({ companyId: 1, action: 1, 'changes.status.to': 1 });
assetHistorySchema.index({ companyId: 1, performedBy: 1, action: 1, 'changes.status.to': 1 });
export const Company = model('Company', companySchema);
export const User = model('User', userSchema);
export const Case = model('Case', caseSchema);
export const Task = model('Task', taskSchema);
export const Handover = model('Handover', handoverSchema);
export const Activity = model('Activity', activitySchema);
export const Ticket = model('Ticket', ticketSchema);
export const Notification = model('Notification', notificationSchema);
export const Event = model('Event', eventSchema);
export const WorkReport = model('WorkReport', workReportSchema);
export const EngineerIssue = model('EngineerIssue', engineerIssueSchema);
export const Asset = model('Asset', assetSchema);
export const AssetWorkEvent = model('AssetWorkEvent', assetWorkEventSchema);
export const AssetHistory = model('AssetHistory', assetHistorySchema);
