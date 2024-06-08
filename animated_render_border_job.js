// SPDX-License-Identifier: GPL-3.0-or-later

const JOB_TYPE = {
    label: "Animated Render Border v2",
    description: "Render a sequence of frames using Animated Render Border",
    settings: [
        // Settings for artists to determine:
        { key: "frames", type: "string", required: true,
          eval: "f'{C.scene.frame_start}-{C.scene.frame_end}'",
          evalInfo: {
            showLinkButton: true,
            description: "Scene frame range",
          },
          description: "Frame range to render. Examples: '47', '1-30', '3, 5-10, 47-327'" },
        { key: "chunk_size", type: "int32", default: 1, description: "Number of frames to render in one Blender render task",
          visible: "submission" },

        { key: "render_output_root", type: "string", subtype: "dir_path", required: true, visible: "submission",
          description: "Base directory of where render output is stored"},

        { key: "render_name", type: "string", required: true, visible: "submission",
          description: "Name of the render output file without extension"},

        { key: "blendfile", type: "string", required: true, description: "Path of the Blend file to render", visible: "web" },
        { key: "fps", type: "float", eval: "C.scene.render.fps / C.scene.render.fps_base", visible: "hidden" },
        { key: "format", type: "string", required: true, eval: "C.scene.render.image_settings.file_format", visible: "web" },
        { key: "image_file_extension", type: "string", required: true, eval: "C.scene.render.file_extension", visible: "hidden",
          description: "File extension used when rendering images" },
    ]
};

// Set of scene.render.image_settings.file_format values that produce
// files which FFmpeg is known not to handle as input.
const ffmpegIncompatibleImageFormats = new Set([
    "EXR",
    "MULTILAYER", // Old CLI-style format indicators
    "OPEN_EXR",
    "OPEN_EXR_MULTILAYER", // DNA values for these formats.
]);

// File formats that would cause rendering to video.
// This is not supported by this job type.
const videoFormats = ['FFMPEG', 'AVI_RAW', 'AVI_JPEG'];

function compileJob(job) {
    print("Blender Render job submitted");
    print("job: ", job);

    const settings = job.settings;
    if (videoFormats.indexOf(settings.format) >= 0) {
        throw `This job type only renders images, and not "${settings.format}"`;
    }

    const renderOutput = renderOutputPath(job);

    // Make sure that when the job is investigated later, it shows the
    // actually-used render output:
    settings.render_output_path = renderOutput;

    const renderDir = path.dirname(renderOutput);
    const renderTasks = authorRenderTasks(settings, renderDir, renderOutput);

    for (const rt of renderTasks) {
        job.addTask(rt);
    }
}

// Do field replacement on the render output path.
function renderOutputPath(job) {
    const settings = job.settings;
    const renderOutputRoot = settings.render_output_root;
    const renderName = settings.render_name;

    if (!renderOutputRoot || !renderName) {
        throw "render_output_root and render_name settings are required!";
    }
    
    return path.join(renderOutputRoot, `${renderName}.####${settings.image_file_extension}`);
}

function authorRenderTasks(settings, renderDir, renderOutput) {
    print("authorRenderTasks(", renderDir, renderOutput, ")");
    let renderTasks = [];
    let chunks = frameChunker(settings.frames, settings.chunk_size);
    for (let chunk of chunks) {
       
        let frameStart, frameEnd;
        
        if (chunk.includes(",")) {
            // Case: Comma-separated list of frames (e.g., "234,235")
            const frames = chunk.split(",");
            frameStart = frames[0];
            frameEnd = frames[frames.length - 1];
        } else if (chunk.includes("-")) {
            // Case: Range of frames (e.g., "234-235")
            const frameRange = chunk.split("-");
            frameStart = frameRange[0];
            frameEnd = frameRange[1];
        } else {
            // Case: Single frame (e.g., "234")
            frameStart = chunk;
            frameEnd = chunk;
        }


        const task = author.Task(`render-${chunk}`, "blender");
        const command = author.Command("blender-render", {
            exe: "{blender}",
            exeArgs: "{blenderArgs}",
            argsBefore: [],
            blendfile: settings.blendfile,
            args: [
                "--render-output", path.join(renderDir, path.basename(renderOutput)),
                "--render-format", settings.format,
                "--frame-start", frameStart,
                "--frame-end", frameEnd,
                "--python-expr" , 'import bpy; bpy.ops.render.animated_render_border_render()'
            ]
        });
        task.addCommand(command);
        renderTasks.push(task);
    }
    return renderTasks;
}
