import { NextResponse } from "next/server";
import { updateAiJobProgress, getAiJob } from "@/lib/maestra-db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { jobId } = body as { jobId?: string };

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

    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return NextResponse.json({
        success: true,
        message: "Job already finished",
        job: {
          id: job.id,
          status: job.status,
        },
      });
    }

    // Mark job as cancelled — the processing loop checks this before each batch
    await updateAiJobProgress(jobId, { status: "cancelled" as "failed" });

    return NextResponse.json({
      success: true,
      message: "Procesamiento AI detenido",
      job: {
        id: jobId,
        status: "cancelled",
      },
    });
  } catch (error) {
    console.error("Stop AI job error:", error);
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Error al detener procesamiento AI",
      },
      { status: 500 }
    );
  }
}
