import { NextResponse } from "next/server";
import { getAiJob } from "@/lib/maestra-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json(
        { success: false, message: "Missing jobId parameter" },
        { status: 400 }
      );
    }

    const job = await getAiJob(jobId);

    if (!job) {
      return NextResponse.json(
        { success: false, message: "Job not found" },
        { status: 404 }
      );
    }

    // Parse batch engine metrics if available
    let batchMetrics = null;
    if (job.batch_metrics) {
      try {
        batchMetrics = JSON.parse(job.batch_metrics);
      } catch {
        // Ignore malformed metrics
      }
    }

    return NextResponse.json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        totalProducts: job.total_products,
        processedProducts: job.processed_products,
        successfulProducts: job.successful_products,
        failedProducts: job.failed_products,
        errors: job.errors ? JSON.parse(job.errors) : null,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        batchMetrics: batchMetrics,
      },
    });
  } catch (error) {
    console.error("Get AI job status error:", error);
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Error al consultar estado del job",
      },
      { status: 500 }
    );
  }
}
