import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./UIComponents.tsx";

interface AssignmentRecommendation {
	userId: string;
	username: string;
	confidence: number;
	reasons: string[];
	potentialConflicts: Array<{
		type: string;
		description: string;
		severity: string;
	}>;
	estimatedCompletionTime: string;
}

interface AssignmentRecommendationsProps {
	taskId: string;
	onAssign?: (userId: string) => void;
	onClose?: () => void;
}

export const AssignmentRecommendations: React.FC<AssignmentRecommendationsProps> = ({
	taskId,
	onAssign,
	onClose,
}) => {
	const [recommendations, setRecommendations] = useState<AssignmentRecommendation[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchRecommendations = useCallback(async () => {
		try {
			setLoading(true);
			const response = await fetch(`/api/schedule/recommendations/${taskId}`);
			const data = await response.json();

			if (data.success && Array.isArray(data.data)) {
				const rawRecommendations = data.data as AssignmentRecommendation[];
				// Enrich with user data
				const enrichedRecommendations = await Promise.all(
					rawRecommendations.map(async (rec) => {
						const userResponse = await fetch(`/api/users/${rec.userId}`);
						const userData = await userResponse.json();

						return {
							...rec,
							username: rec.username || userData.user?.username || `User ${rec.userId}`,
							estimatedCompletionTime: new Date(rec.estimatedCompletionTime).toLocaleDateString(),
						};
					}),
				);

				setRecommendations(enrichedRecommendations);
			} else {
				setError("Failed to load recommendations");
			}
		} catch (_err) {
			setError("Error loading recommendations");
		} finally {
			setLoading(false);
		}
	}, [taskId]);

	useEffect(() => {
		fetchRecommendations();
	}, [fetchRecommendations]);

	const handleAssign = async (userId: string) => {
		try {
			const response = await fetch(`/api/tasks/${taskId}/assign`, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${localStorage.getItem("token")}`,
				},
				body: JSON.stringify({ assignedTo: userId }),
			});

			if (response.ok) {
				onAssign?.(userId);
				onClose?.();
			} else {
				setError("Failed to assign task");
			}
		} catch (_err) {
			setError("Error assigning task");
		}
	};

	const getConfidenceColor = (confidence: number) => {
		if (confidence >= 80) return "text-green-600";
		if (confidence >= 60) return "text-yellow-600";
		return "text-red-600";
	};

	const getSeverityColor = (severity: string) => {
		switch (severity) {
			case "critical":
				return "text-red-600";
			case "high":
				return "text-orange-600";
			case "medium":
				return "text-yellow-600";
			case "low":
				return "text-blue-600";
			default:
				return "text-gray-600";
		}
	};

	if (loading) {
		return (
			<Card className="w-full max-w-2xl">
				<CardContent className="p-6">
					<div className="flex items-center justify-center">
						<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
						<span className="ml-2">Loading recommendations...</span>
					</div>
				</CardContent>
			</Card>
		);
	}

	if (error) {
		return (
			<Card className="w-full max-w-2xl">
				<CardContent className="p-6">
					<div className="text-red-600 text-center">{error}</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="w-full max-w-2xl">
			<CardHeader>
				<div className="flex justify-between items-center">
					<CardTitle>Assignment Recommendations</CardTitle>
					{onClose && (
						<button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700">
							×
						</button>
					)}
				</div>
			</CardHeader>
			<CardContent className="p-6">
				{recommendations.length === 0 ? (
					<div className="text-center text-gray-500">
						No suitable assignees found for this task.
					</div>
				) : (
					<div className="space-y-4">
						{recommendations.map((rec) => (
							<div
								key={rec.userId}
								className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
							>
								<div className="flex justify-between items-start mb-3">
									<div>
										<h3 className="font-semibold text-lg">{rec.username}</h3>
										<div className="flex items-center space-x-2 mt-1">
											<span className="text-sm text-gray-500">Confidence:</span>
											<span className={`font-bold ${getConfidenceColor(rec.confidence)}`}>
												{rec.confidence}%
											</span>
										</div>
									</div>
									<div className="text-right">
										<div className="text-sm text-gray-500">Est. completion:</div>
										<div className="font-medium">{rec.estimatedCompletionTime}</div>
									</div>
								</div>

								{rec.reasons.length > 0 && (
									<div className="mb-3">
										<h4 className="font-medium text-sm text-gray-700 mb-2">Reasons:</h4>
										<ul className="text-sm text-gray-600 space-y-1">
											{rec.reasons.map((reason) => (
												<li key={`${rec.userId}-reason-${reason}`} className="flex items-start">
													<span className="text-green-500 mr-2">✓</span>
													{reason}
												</li>
											))}
										</ul>
									</div>
								)}

								{rec.potentialConflicts.length > 0 && (
									<div className="mb-3">
										<h4 className="font-medium text-sm text-gray-700 mb-2">Potential Conflicts:</h4>
										<div className="space-y-2">
											{rec.potentialConflicts.map((conflict) => (
												<div
													key={`${rec.userId}-${conflict.type}-${conflict.description}`}
													className="text-sm p-2 bg-yellow-50 border border-yellow-200 rounded"
												>
													<div className="flex items-center justify-between">
														<span className="font-medium">{conflict.description}</span>
														<span
															className={`text-xs font-medium ${getSeverityColor(conflict.severity)}`}
														>
															{conflict.severity.toUpperCase()}
														</span>
													</div>
												</div>
											))}
										</div>
									</div>
								)}

								<div className="flex justify-end">
									<button
										type="button"
										onClick={() => handleAssign(rec.userId)}
										className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
									>
										Assign to {rec.username}
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
};
