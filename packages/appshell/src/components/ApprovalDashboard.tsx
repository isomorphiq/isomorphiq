import { useCallback, useEffect, useState } from "react";
import type { ApprovalStats, TaskApproval } from "@isomorphiq/workflow/approval-types";

type ApprovalDashboardProps = {
    userId: string;
};

export function ApprovalDashboard({ userId }: ApprovalDashboardProps) {
	const [pendingApprovals, setPendingApprovals] = useState<TaskApproval[]>([]);
	const [myApprovals, setMyApprovals] = useState<TaskApproval[]>([]);
	const [stats, setStats] = useState<ApprovalStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState("pending");

	const fetchData = useCallback(async () => {
		try {
			setLoading(true);
			const [pendingResponse, myApprovalsResponse, statsResponse] = await Promise.all([
				fetch("/api/approval/approvals?status=pending", {
					headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
				}),
				fetch(`/api/approval/approvals?approverId=${userId}`, {
					headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
				}),
				fetch(`/api/approval/stats?userId=${userId}`, {
					headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
				}),
			]);

			if (!pendingResponse.ok || !myApprovalsResponse.ok || !statsResponse.ok) {
				throw new Error("Failed to fetch approval data");
			}

			const pendingData = await pendingResponse.json();
			const myApprovalsData = await myApprovalsResponse.json();
			const statsData = await statsResponse.json();

			setPendingApprovals(pendingData);
			setMyApprovals(myApprovalsData);
			setStats(statsData);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unknown error");
		} finally {
			setLoading(false);
		}
	}, [userId]);

	const handleApproval = async (
		approvalId: string,
		stageId: string,
		action: "approve" | "reject" | "request_changes",
		comment?: string,
	) => {
		try {
			const response = await fetch(`/api/approval/approvals/${approvalId}/process`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${localStorage.getItem("authToken")}`,
				},
				body: JSON.stringify({ stageId, action, comment }),
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || "Failed to process approval");
			}

			await fetchData();
		} catch (err) {
			alert(`Error processing approval: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	};

	const _getStatusColor = (status: string) => {
		switch (status) {
			case "pending":
				return "bg-yellow-100 text-yellow-800";
			case "approved":
				return "bg-green-100 text-green-800";
			case "rejected":
				return "bg-red-100 text-red-800";
			case "changes_requested":
				return "bg-blue-100 text-blue-800";
			default:
				return "bg-gray-100 text-gray-800";
		}
	};

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
				<span className="ml-2">Loading approval data...</span>
			</div>
		);
	}

	if (error) {
		return <div className="text-center text-red-600 p-8">{error}</div>;
	}

	return (
		<div className="p-6">
			<div className="mb-6">
				<h1 className="text-2xl font-bold mb-2">Approval Dashboard</h1>
				<p className="text-gray-600">Manage task approvals and workflow decisions</p>
			</div>

			{/* Stats Cards */}
			{stats && (
				<div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
					<div className="bg-white p-6 rounded-lg shadow">
						<h3 className="text-sm font-medium text-gray-500 mb-2">Total Approvals</h3>
						<p className="text-2xl font-bold text-orange-600">{stats.totalApprovals || 0}</p>
					</div>
					<div className="bg-white p-6 rounded-lg shadow">
						<h3 className="text-sm font-medium text-gray-500 mb-2">Completed</h3>
						<p className="text-2xl font-bold text-green-600">{stats.totalApprovals || 0}</p>
					</div>
					<div className="bg-white p-6 rounded-lg shadow">
						<h3 className="text-sm font-medium text-gray-500 mb-2">Pending</h3>
						<p className="text-2xl font-bold text-blue-600">{pendingApprovals.length}</p>
					</div>
					<div className="bg-white p-6 rounded-lg shadow">
						<h3 className="text-sm font-medium text-gray-500 mb-2">My Approvals</h3>
						<p className="text-2xl font-bold text-purple-600">{myApprovals.length}</p>
					</div>
				</div>
			)}

			{/* Tabs */}
			<div className="border-b border-gray-200 mb-6">
				<nav className="-mb-px flex space-x-8">
					{[
						{ id: "pending", label: "Pending Approvals", count: pendingApprovals.length },
						{ id: "my", label: "My Approvals", count: myApprovals.length },
					].map((tab) => (
						<button
							key={tab.id}
							type="button"
							onClick={() => setActiveTab(tab.id)}
							className={`py-2 px-1 border-b-2 font-medium text-sm ${
								activeTab === tab.id
									? "border-blue-500 text-blue-600"
									: "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
							}`}
						>
							{tab.label} ({tab.count})
						</button>
					))}
				</nav>
			</div>

			{/* Tab Content */}
			{activeTab === "pending" && (
				<div className="space-y-4">
					{pendingApprovals.length === 0 ? (
						<div className="text-center py-8 text-gray-500">No pending approvals.</div>
					) : (
						pendingApprovals.map((approval) => (
							<ApprovalCard
								key={approval.id}
								approval={approval}
								onApprove={(stageId, comment) =>
									handleApproval(approval.id, stageId, "approve", comment)
								}
								onReject={(stageId, comment) =>
									handleApproval(approval.id, stageId, "reject", comment)
								}
								onRequestChanges={(stageId, comment) =>
									handleApproval(approval.id, stageId, "request_changes", comment)
								}
							/>
						))
					)}
				</div>
			)}

			{activeTab === "my" && (
				<div className="space-y-4">
					{myApprovals.length === 0 ? (
						<div className="text-center py-8 text-gray-500">No approvals assigned to you.</div>
					) : (
						myApprovals.map((approval) => (
							<ApprovalCard
								key={approval.id}
								approval={approval}
								onApprove={(stageId, comment) =>
									handleApproval(approval.id, stageId, "approve", comment)
								}
								onReject={(stageId, comment) =>
									handleApproval(approval.id, stageId, "reject", comment)
								}
								onRequestChanges={(stageId, comment) =>
									handleApproval(approval.id, stageId, "request_changes", comment)
								}
							/>
						))
					)}
				</div>
			)}
		</div>
	);
}

interface ApprovalCardProps {
	approval: TaskApproval;
	onApprove: (stageId: string, comment?: string) => void;
	onReject: (stageId: string, comment?: string) => void;
	onRequestChanges: (stageId: string, comment?: string) => void;
}

function ApprovalCard({ approval, onApprove, onReject, onRequestChanges }: ApprovalCardProps) {
	const getStatusColor = (status: string) => {
		switch (status) {
			case "pending":
				return "bg-yellow-100 text-yellow-800";
			case "approved":
				return "bg-green-100 text-green-800";
			case "rejected":
				return "bg-red-100 text-red-800";
			case "changes_requested":
				return "bg-blue-100 text-blue-800";
			default:
				return "bg-gray-100 text-gray-800";
		}
	};
	const [comment, setComment] = useState("");
	const [showActions, setShowActions] = useState(false);

	const currentStage = approval.stages[approval.currentStage];
	const myPendingDecisions = currentStage?.approvers.filter((approver) => !approver.decision) || [];

	return (
		<div
			style={{
				background: "#1f2937",
				border: "1px solid #374151",
				borderRadius: "8px",
				padding: "16px",
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
					marginBottom: "12px",
				}}
			>
				<div>
					<h3 style={{ margin: 0, fontSize: "16px", fontWeight: "600", color: "#f3f4f6" }}>
						Task Approval #{approval.id}
					</h3>
					<p style={{ margin: "4px 0 0 0", fontSize: "14px", color: "#9ca3af" }}>
						Stage: {currentStage?.stageId || "Unknown"} · Status:{" "}
						<span
							className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(approval.status)}`}
						>
							{approval.status}
						</span>
					</p>
				</div>
				{myPendingDecisions.length > 0 && (
					<button
						type="button"
						onClick={() => setShowActions(!showActions)}
						style={{
							padding: "8px 16px",
							background: "#3b82f6",
							color: "white",
							border: "none",
							borderRadius: "6px",
							cursor: "pointer",
							fontSize: "14px",
						}}
					>
						{showActions ? "Hide Actions" : "Show Actions"}
					</button>
				)}
			</div>

			{showActions && myPendingDecisions.length > 0 && (
				<div style={{ marginTop: "16px" }}>
					<textarea
						value={comment}
						onChange={(e) => setComment(e.target.value)}
						placeholder="Add a comment (optional)..."
						style={{
							width: "100%",
							padding: "8px",
							background: "#374151",
							border: "1px solid #4b5563",
							borderRadius: "4px",
							color: "#f3f4f6",
							fontSize: "14px",
							marginBottom: "12px",
							minHeight: "80px",
							resize: "vertical",
						}}
					/>

					<div style={{ display: "flex", gap: "8px" }}>
						<button
							type="button"
							onClick={() => onApprove(currentStage.stageId, comment)}
							style={{
								padding: "8px 16px",
								background: "#10b981",
								color: "white",
								border: "none",
								borderRadius: "4px",
								cursor: "pointer",
								fontSize: "14px",
							}}
						>
							Approve
						</button>
						<button
							type="button"
							onClick={() => onRequestChanges(currentStage.stageId, comment)}
							style={{
								padding: "8px 16px",
								background: "#f59e0b",
								color: "white",
								border: "none",
								borderRadius: "4px",
								cursor: "pointer",
								fontSize: "14px",
							}}
						>
							Request Changes
						</button>
						<button
							type="button"
							onClick={() => onReject(currentStage.stageId, comment)}
							style={{
								padding: "8px 16px",
								background: "#ef4444",
								color: "white",
								border: "none",
								borderRadius: "4px",
								cursor: "pointer",
								fontSize: "14px",
							}}
						>
							Reject
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
