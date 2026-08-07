# Third-party notices

`size-tape-calculator` bundles browser worker code from the projects below so
that consumers do not need to install TensorFlow packages at runtime.

| Project | License | Use in this package |
| --- | --- | --- |
| [TensorFlow.js](https://github.com/tensorflow/tfjs) | Apache License 2.0 | Pose-detection worker runtime |
| [TensorFlow.js Models / pose-detection](https://github.com/tensorflow/tfjs-models/tree/master/pose-detection) | Apache License 2.0 | MoveNet detector in the worker |
| [MediaPipe Pose](https://github.com/google-ai-edge/mediapipe) | Apache License 2.0 | Transitive browser code in the pose-detection bundle |

The Apache License 2.0 text is included in
[`LICENSES/Apache-2.0.txt`](./LICENSES/Apache-2.0.txt).

The optional Selfie Segmentation runtime and default MoveNet model weights are
fetched by the browser at runtime. They are not bundled in this npm tarball.
See the README's **Privacy, network, and CSP** section for deployment details.
